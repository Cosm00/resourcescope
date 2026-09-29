use serde::Serialize;
use std::time::{Duration, Instant};

#[derive(Serialize, Clone, Debug, Default)]
pub struct GpuInfo {
    pub platform: String,
    pub name: String,
    pub vendor: String,
    pub core_count: Option<usize>,
    pub utilization_pct: Option<f32>,
    pub renderer_utilization_pct: Option<f32>,
    pub tiler_utilization_pct: Option<f32>,
    pub memory_used_bytes: Option<u64>,
    pub memory_allocated_bytes: Option<u64>,
    pub memory_driver_bytes: Option<u64>,
    pub memory_total_bytes: Option<u64>,
    pub temperature_c: Option<f32>,
    pub power_state: Option<u64>,
    /// Current graphics clock in MHz, when a backend exposes it.
    pub frequency_mhz: Option<u64>,
    pub last_submission_pid: Option<u32>,
    pub adapter_index: Option<u32>,
    pub backend: String,
    pub support_level: String,
    pub notes: Option<String>,
    pub collection_method: String,
}

pub struct GpuCollector {
    static_infos: Vec<GpuInfo>,
    cached: Vec<GpuInfo>,
    last_refresh: Option<Instant>,
    refresh_interval: Duration,
}

impl GpuCollector {
    pub fn new() -> Self {
        let mut static_infos = platform::collect_static_all();
        if static_infos.is_empty() {
            static_infos.extend(platform::unsupported_info());
        }
        Self {
            cached: static_infos.clone(),
            static_infos,
            last_refresh: None,
            refresh_interval: Duration::from_secs(3),
        }
    }

    /// Every GPU, most relevant first (discrete before integrated on Linux,
    /// DXGI order — primary display adapter first — on Windows).
    pub fn collect(&mut self) -> Vec<GpuInfo> {
        let should_refresh = self
            .last_refresh
            .map(|t| t.elapsed() >= self.refresh_interval)
            .unwrap_or(true);

        if should_refresh {
            let dynamic = platform::collect_dynamic_all(&self.static_infos);
            if !dynamic.is_empty() {
                self.cached = dynamic;
            }
            self.last_refresh = Some(Instant::now());
        }

        self.cached.clone()
    }
}

#[cfg(target_os = "macos")]
mod platform {
    use super::GpuInfo;
    use std::process::Command;

    #[derive(Default, Clone)]
    struct PowerMetricsGpuInfo {
        active_residency_pct: Option<f32>,
        frequency_mhz: Option<u64>,
        power_mw: Option<u64>,
        backend: Option<String>,
        notes: Option<String>,
    }

    const IOREG_PATH: &str = "/usr/sbin/ioreg";
    const IOREG_CLASS_CANDIDATES: &[&str] = &[
        "IOAccelerator",
        "AGXAccelerator",
        "AGXAcceleratorG13G",
        "AGXAcceleratorG14G",
        "AGXAcceleratorG15G",
        "AGXAcceleratorG16G",
        "AppleCLCD2",
    ];

    /// One GPU as `system_profiler SPDisplaysDataType` describes it.
    #[derive(Default, Clone, Debug, PartialEq)]
    pub(super) struct ProfilerGpu {
        pub name: Option<String>,
        pub vendor: Option<String>,
        pub core_count: Option<usize>,
        pub vram_bytes: Option<u64>,
    }

    /// One IOAccelerator node: its class and `ioreg -l` property dump.
    #[derive(Debug)]
    pub(super) struct Accelerator {
        pub class: String,
        pub dump: String,
    }

    /// Every GPU on the machine: Apple silicon has one, Intel Macs can have an
    /// integrated Intel GPU plus a discrete AMD/NVIDIA one (or an eGPU).
    pub fn collect_static_all() -> Vec<GpuInfo> {
        let accels = accelerators();
        let profiler = collect_system_profiler_gpus();
        let mut used = vec![false; profiler.len()];
        accels
            .iter()
            .enumerate()
            .map(|(i, accel)| {
                let vendor = accelerator_vendor(accel);
                let pick = profiler
                    .iter()
                    .enumerate()
                    .position(|(j, p)| !used[j] && p.vendor.as_deref().is_some_and(|v| v.eq_ignore_ascii_case(&vendor)))
                    .or_else(|| (accels.len() == 1 && !profiler.is_empty()).then_some(0));
                if let Some(j) = pick {
                    used[j] = true;
                }
                static_info(accel, pick.map(|j| &profiler[j]), i as u32)
            })
            .collect()
    }

    pub fn collect_dynamic_all(base: &[GpuInfo]) -> Vec<GpuInfo> {
        let accels = accelerators();
        // powermetrics reports one GPU (Apple silicon); don't guess which
        // adapter its numbers belong to on multi-GPU Intel Macs.
        let power_metrics = if accels.len() == 1 { Some(collect_powermetrics_gpu_info()) } else { None };
        accels
            .iter()
            .enumerate()
            .map(|(i, accel)| {
                let mut info = base
                    .iter()
                    .find(|b| b.adapter_index == Some(i as u32))
                    .cloned()
                    .unwrap_or_else(|| static_info(accel, None, i as u32));
                apply_dynamic(&mut info, accel, power_metrics.as_ref());
                info
            })
            .collect()
    }

    pub fn unsupported_info() -> Option<GpuInfo> {
        None
    }

    fn static_info(accel: &Accelerator, profiler: Option<&ProfilerGpu>, index: u32) -> GpuInfo {
        let output = &accel.dump;
        let class_name = &accel.class;
        let io_compat = extract_braced_object(output, "IOCompatibilityProperties");
        let vendor = profiler.and_then(|p| p.vendor.clone()).unwrap_or_else(|| accelerator_vendor(accel));
        let name = profiler.and_then(|p| p.name.clone())
            .or_else(|| extract_quoted_value(output, "model"))
            .or_else(|| io_compat.as_deref().and_then(|obj| extract_object_string(obj, "MetalPluginName")))
            .or_else(|| io_compat.as_deref().and_then(|obj| extract_object_string(obj, "IOGLBundleName")))
            .or_else(|| extract_quoted_value(output, "CFBundleName"))
            .or_else(|| infer_name_from_class(class_name, &vendor))
            .unwrap_or_else(|| format!("{} GPU", vendor));
        let core_count = profiler.and_then(|p| p.core_count).or_else(|| {
            extract_u64_value(output, "gpu-core-count")
                .or_else(|| extract_u64_value(output, "num_cores"))
                .map(|v| v as usize)
        });

        let mut info = GpuInfo {
            platform: "macOS".to_string(),
            name,
            vendor,
            core_count,
            memory_total_bytes: memory_total(output, io_compat.as_deref()).or(profiler.and_then(|p| p.vram_bytes)),
            power_state: extract_nested_u64_value(output, "IOPowerManagement", "CurrentPowerState"),
            adapter_index: Some(index),
            backend: "macos-ioreg".to_string(),
            support_level: if output.contains("PerformanceStatistics") { "full" } else { "partial" }.to_string(),
            notes: Some(format!("IORegistry node {class_name}; identity from system_profiler.")),
            collection_method: format!("ioreg -r -d 1 -c IOAccelerator ({class_name})"),
            ..Default::default()
        };
        apply_performance_statistics(&mut info, output, io_compat.as_deref());
        info
    }

    fn memory_total(output: &str, io_compat: Option<&str>) -> Option<u64> {
        extract_u64_value(output, "recommendedMaxWorkingSetSize")
            .or_else(|| extract_u64_value(output, "VRAM,totalMB").map(|mb| mb * 1024 * 1024))
            .or_else(|| io_compat.and_then(|obj| extract_object_u64(obj, "VRAM,totalMB")).map(|mb| mb * 1024 * 1024))
    }

    /// Fill live fields from the node's `PerformanceStatistics`. Apple silicon
    /// reports Device/Renderer/Tiler utilization; AMD and Intel drivers on
    /// Intel Macs use their own keys ("GPU Activity(%)", "Temperature(C)", …).
    fn apply_performance_statistics(info: &mut GpuInfo, output: &str, io_compat: Option<&str>) -> bool {
        let Some(perf) = extract_braced_object(output, "PerformanceStatistics")
            .or_else(|| io_compat.and_then(|obj| extract_braced_object(obj, "PerformanceStatistics")))
        else {
            return false;
        };
        info.utilization_pct = extract_object_f32(&perf, "Device Utilization %")
            .or_else(|| extract_object_f32(&perf, "GPU Activity(%)"))
            .or_else(|| extract_object_f32(&perf, "GPU Core Utilization"))
            .map(|v| v.clamp(0.0, 100.0));
        info.renderer_utilization_pct = extract_object_f32(&perf, "Renderer Utilization %");
        info.tiler_utilization_pct = extract_object_f32(&perf, "Tiler Utilization %");
        info.memory_used_bytes = extract_object_u64(&perf, "In use system memory")
            .or_else(|| extract_object_u64(&perf, "vramUsedBytes"));
        info.memory_allocated_bytes = extract_object_u64(&perf, "Alloc system memory");
        info.memory_driver_bytes = extract_object_u64(&perf, "In use system memory (driver)");
        if info.memory_used_bytes.is_none() {
            info.memory_used_bytes = derive_used_memory_from_vram_free(&perf, info.memory_total_bytes);
        }
        if let Some(t) = extract_object_f32(&perf, "Temperature(C)").filter(|t| *t > 0.0 && *t < 150.0) {
            info.temperature_c = Some(t);
        }
        if let Some(mhz) = extract_object_u64(&perf, "Core Clock(MHz)").filter(|v| *v > 0) {
            info.frequency_mhz = Some(mhz);
        }
        true
    }

    fn apply_dynamic(info: &mut GpuInfo, accel: &Accelerator, power_metrics: Option<&PowerMetricsGpuInfo>) {
        let output = &accel.dump;
        let class_name = &accel.class;
        let io_compat = extract_braced_object(output, "IOCompatibilityProperties");
        let has_perf = apply_performance_statistics(info, output, io_compat.as_deref());
        info.support_level = if has_perf { "full" } else { "partial" }.to_string();
        info.memory_total_bytes = info.memory_total_bytes.or_else(|| memory_total(output, io_compat.as_deref()));
        info.power_state = extract_nested_u64_value(output, "IOPowerManagement", "CurrentPowerState");
        info.last_submission_pid = extract_nested_u64_value(output, "AGCInfo", "fLastSubmissionPID").map(|v| v as u32);
        info.backend = "macos-ioreg".to_string();
        info.collection_method = format!("ioreg -r -d 1 -c IOAccelerator ({class_name})");

        let mut extra = None;
        if let Some(pm) = power_metrics {
            if let Some(active) = pm.active_residency_pct {
                info.utilization_pct = Some(active);
                info.support_level = "full".to_string();
            }
            if let Some(freq) = pm.frequency_mhz {
                info.frequency_mhz = Some(freq);
            }
            if let Some(backend) = pm.backend.clone() {
                info.backend = backend;
            }
            extra = pm.notes.clone();
        }
        let temp_note = if info.temperature_c.is_some() { "" } else { " The driver doesn't publish a GPU temperature." };
        info.notes = Some(match extra {
            Some(extra) => format!("IORegistry node {class_name}.{temp_note} {extra}"),
            None => format!("IORegistry node {class_name}.{temp_note}"),
        });
    }

    /// Every IOAccelerator, discrete GPUs first. `-c` matches subclasses —
    /// AGXAccelerator* (Apple silicon), IntelAccelerator, AMDRadeonX*…,
    /// nvAccelerator — and `-d 1` keeps each node's user clients out of the dump.
    fn accelerators() -> Vec<Accelerator> {
        let mut accels: Vec<Accelerator> = Command::new(IOREG_PATH)
            .args(["-r", "-d", "1", "-w", "0", "-c", "IOAccelerator", "-l"])
            .output()
            .ok()
            .filter(|o| o.status.success())
            .and_then(|o| String::from_utf8(o.stdout).ok())
            .map(|text| split_ioreg_nodes(&text))
            .unwrap_or_default()
            .into_iter()
            .filter(|a| looks_like_gpu_dump(&a.dump))
            .collect();
        if accels.is_empty() {
            // Older approach by node name, in case class matching finds nothing.
            if let Some((class, dump)) = find_gpu_ioreg_dump() {
                accels.push(Accelerator { class, dump });
            }
        }
        accels.sort_by_key(|a| accelerator_vendor(a) == "Intel");
        accels
    }

    /// Split `ioreg -l` output into its top-level `+-o Name  <class X, …>` nodes.
    pub(super) fn split_ioreg_nodes(text: &str) -> Vec<Accelerator> {
        let mut nodes: Vec<Accelerator> = Vec::new();
        for line in text.lines() {
            if let Some(header) = line.trim_start().strip_prefix("+-o ") {
                let class = header
                    .split_once("<class ")
                    .and_then(|(_, rest)| rest.split([',', '>']).next())
                    .unwrap_or_else(|| header.split_whitespace().next().unwrap_or(""))
                    .trim()
                    .to_string();
                nodes.push(Accelerator { class, dump: String::new() });
            } else if let Some(node) = nodes.last_mut() {
                node.dump.push_str(line);
                node.dump.push('\n');
            }
        }
        nodes
    }

    /// Vendor from the accelerator's class. Scanning the whole dump would call
    /// every GPU "Apple": they all carry com.apple bundle ids.
    pub(super) fn accelerator_vendor(accel: &Accelerator) -> String {
        let class = extract_quoted_value(&accel.dump, "IOClass").unwrap_or_else(|| accel.class.clone()).to_ascii_lowercase();
        if class.contains("agx") || class.starts_with("apple") {
            "Apple".to_string()
        } else if class.contains("intel") {
            "Intel".to_string()
        } else if class.contains("amd") || class.contains("radeon") {
            "AMD".to_string()
        } else if class.starts_with("nv") || class.contains("nvidia") || class.contains("geforce") {
            "NVIDIA".to_string()
        } else {
            infer_vendor(&accel.dump)
        }
    }

    fn collect_system_profiler_gpus() -> Vec<ProfilerGpu> {
        let output = match Command::new("/usr/sbin/system_profiler")
            .args(["SPDisplaysDataType"])
            .output()
        {
            Ok(output) if output.status.success() => output,
            _ => return Vec::new(),
        };
        String::from_utf8(output.stdout).map(|t| parse_system_profiler(&t)).unwrap_or_default()
    }

    /// Each GPU section starts at its "Chipset Model:" line.
    pub(super) fn parse_system_profiler(text: &str) -> Vec<ProfilerGpu> {
        let mut gpus: Vec<ProfilerGpu> = Vec::new();
        for line in text.lines() {
            let trimmed = line.trim();
            if let Some(value) = trimmed.strip_prefix("Chipset Model: ") {
                gpus.push(ProfilerGpu { name: Some(value.trim().to_string()), ..Default::default() });
                continue;
            }
            let Some(gpu) = gpus.last_mut() else { continue };
            if let Some(value) = trimmed.strip_prefix("Vendor: ") {
                if gpu.vendor.is_none() {
                    let vendor = value.split('(').next().unwrap_or(value).trim();
                    // "sppci_vendor_Apple" on some releases.
                    let vendor = vendor.rsplit('_').next().unwrap_or(vendor);
                    gpu.vendor = Some(vendor.to_string());
                }
            } else if let Some(value) = trimmed.strip_prefix("Total Number of Cores: ") {
                gpu.core_count = value.trim().parse().ok();
            } else if let Some((key, value)) = trimmed.split_once(": ") {
                if key.starts_with("VRAM") && gpu.vram_bytes.is_none() {
                    gpu.vram_bytes = parse_size(value);
                }
            }
        }
        gpus
    }

    /// "8 GB" / "1536 MB" → bytes.
    fn parse_size(value: &str) -> Option<u64> {
        let mut parts = value.split_whitespace();
        let n: f64 = parts.next()?.parse().ok()?;
        let mult = match parts.next()?.to_ascii_uppercase().as_str() {
            "GB" => 1024.0 * 1024.0 * 1024.0,
            "MB" => 1024.0 * 1024.0,
            _ => return None,
        };
        Some((n * mult) as u64)
    }

    fn collect_powermetrics_gpu_info() -> PowerMetricsGpuInfo {
        let helper_cmd = std::env::var("RESOURCESCOPE_GPU_HELPER")
            .unwrap_or_else(|_| "/usr/local/bin/resourcescope-gpu-helper".to_string());
        let json_helper_cmd = std::env::var("RESOURCESCOPE_GPU_HELPER_JSON")
            .unwrap_or_else(|_| "/usr/local/bin/resourcescope-gpu-helper-json".to_string());
        // powermetrics refuses to run without root; don't spawn a shell and a
        // doomed powermetrics every few seconds unless a helper is installed.
        let helper_installed = std::path::Path::new(&helper_cmd).exists() || std::path::Path::new(&json_helper_cmd).exists();
        if !helper_installed && unsafe { libc::geteuid() } != 0 {
            return PowerMetricsGpuInfo {
                notes: Some(format!("For GPU active residency and clocks, install an elevated powermetrics helper at {helper_cmd} or {json_helper_cmd} (or set RESOURCESCOPE_GPU_HELPER / RESOURCESCOPE_GPU_HELPER_JSON).")),
                ..Default::default()
            };
        }
        let shell_cmd = format!("if [ -x \"{json_helper_cmd}\" ]; then \"{json_helper_cmd}\"; elif [ -x \"{helper_cmd}\" ]; then \"{helper_cmd}\"; else powermetrics -n 1 -i 1000 --samplers gpu_power --format plist 2>/dev/null || true; fi");
        // Plain `sh -c`: a login shell (`-l`) re-sources the user's profile on
        // every poll, which is slow and can print noise into stdout.
        let output = match Command::new("/bin/sh")
            .args(["-c", &shell_cmd])
            .output()
        {
            Ok(output) => output,
            Err(_) => return PowerMetricsGpuInfo::default(),
        };

        let text = match String::from_utf8(output.stdout) {
            Ok(text) => text,
            Err(_) => return PowerMetricsGpuInfo::default(),
        };

        if text.trim().is_empty() {
            return PowerMetricsGpuInfo {
                notes: Some(format!("powermetrics needs elevated privileges; configure and run an elevated helper at {} or {} (or set RESOURCESCOPE_GPU_HELPER / RESOURCESCOPE_GPU_HELPER_JSON) for fuller macOS GPU telemetry.", helper_cmd, json_helper_cmd)),
                ..Default::default()
            };
        }

        if let Some(info) = parse_helper_json_output(&text) {
            return info;
        }

        let mut info = PowerMetricsGpuInfo::default();
        info.backend = Some("macos-powermetrics".to_string());
        info.active_residency_pct = extract_plist_real(&text, "gpu_active_residency_pct").map(|v| v as f32);
        info.frequency_mhz = extract_plist_real(&text, "freq_hz").map(|v| (v / 1_000_000.0) as u64);
        info.power_mw = extract_plist_real(&text, "power_mw").map(|v| v as u64);
        info.notes = Some(match (info.active_residency_pct, info.frequency_mhz, info.power_mw) {
            (Some(active), Some(freq), Some(power)) => format!("powermetrics reported GPU active residency {active:.1}%, frequency {freq} MHz, and power {power} mW."),
            (Some(active), Some(freq), None) => format!("powermetrics reported GPU active residency {active:.1}% and frequency {freq} MHz."),
            (Some(active), None, _) => format!("powermetrics reported GPU active residency {active:.1}%."),
            _ => "powermetrics returned output, but no recognized GPU fields were parsed.".to_string(),
        });
        info
    }

    fn find_gpu_ioreg_dump() -> Option<(String, String)> {
        for class_name in IOREG_CLASS_CANDIDATES {
            if let Some(output) = run_ioreg(class_name) {
                if looks_like_gpu_dump(&output) {
                    return Some(((*class_name).to_string(), output));
                }
            }
        }
        None
    }

    fn looks_like_gpu_dump(output: &str) -> bool {
        output.contains("PerformanceStatistics")
            || output.contains("gpu-core-count")
            || output.contains("AGCInfo")
            || output.contains("MetalPluginName")
            || output.contains("vendor-id")
    }

    fn run_ioreg(class_name: &str) -> Option<String> {
        let output = Command::new(IOREG_PATH)
            .args(["-r", "-n", class_name, "-l"])
            .output()
            .ok()?;
        if !output.status.success() {
            return None;
        }
        String::from_utf8(output.stdout).ok()
    }

    fn infer_vendor(output: &str) -> String {
        let lower = output.to_lowercase();
        if lower.contains("apple") || lower.contains("agx") {
            "Apple".to_string()
        } else if lower.contains("amd") || lower.contains("radeon") {
            "AMD".to_string()
        } else if lower.contains("nvidia") || lower.contains("geforce") || lower.contains("quadro") {
            "NVIDIA".to_string()
        } else if lower.contains("intel") {
            "Intel".to_string()
        } else {
            "Unknown".to_string()
        }
    }

    fn infer_name_from_class(class_name: &str, vendor: &str) -> Option<String> {
        if class_name.contains("AGX") {
            Some(format!("{vendor} Silicon GPU"))
        } else if class_name.contains("IOAccelerator") {
            Some(format!("{vendor} Graphics Adapter"))
        } else {
            None
        }
    }

    fn extract_quoted_value(s: &str, key: &str) -> Option<String> {
        let needle = format!("\"{}\" = \"", key);
        let start = s.find(&needle)? + needle.len();
        let rest = &s[start..];
        let end = rest.find('"')?;
        Some(rest[..end].to_string())
    }

    fn extract_u64_value(s: &str, key: &str) -> Option<u64> {
        let needle = format!("\"{}\" = ", key);
        let start = s.find(&needle)? + needle.len();
        parse_leading_u64(&s[start..])
    }

    fn extract_nested_u64_value(s: &str, object_key: &str, inner_key: &str) -> Option<u64> {
        let obj = extract_braced_object(s, object_key)?;
        extract_object_u64(&obj, inner_key)
    }

    fn extract_object_u64(object: &str, key: &str) -> Option<u64> {
        let needle = format!("\"{}\"=", key);
        let start = object.find(&needle)? + needle.len();
        parse_leading_u64(&object[start..])
    }

    fn extract_object_string(object: &str, key: &str) -> Option<String> {
        let needle = format!("\"{}\"=\"", key);
        let start = object.find(&needle)? + needle.len();
        let rest = &object[start..];
        let end = rest.find('"')?;
        Some(rest[..end].to_string())
    }

    fn extract_object_f32(object: &str, key: &str) -> Option<f32> {
        let needle = format!("\"{}\"=", key);
        let start = object.find(&needle)? + needle.len();
        parse_leading_f32(&object[start..])
    }

    fn extract_braced_object(s: &str, key: &str) -> Option<String> {
        let needle = format!("\"{}\" = {{", key);
        let start = s.find(&needle)? + needle.len() - 1;
        let mut depth = 0usize;
        let mut end_idx = None;

        for (idx, ch) in s[start..].char_indices() {
            match ch {
                '{' => depth += 1,
                '}' => {
                    if depth == 0 {
                        return None;
                    }
                    depth -= 1;
                    if depth == 0 {
                        end_idx = Some(start + idx + 1);
                        break;
                    }
                }
                _ => {}
            }
        }

        let end = end_idx?;
        Some(s[start..end].to_string())
    }

    fn parse_leading_u64(s: &str) -> Option<u64> {
        let digits: String = s
            .chars()
            .skip_while(|c| c.is_whitespace())
            .take_while(|c| c.is_ascii_digit())
            .collect();
        if digits.is_empty() {
            None
        } else {
            digits.parse().ok()
        }
    }

    fn parse_helper_json_output(text: &str) -> Option<PowerMetricsGpuInfo> {
        let value: serde_json::Value = serde_json::from_str(text).ok()?;
        Some(PowerMetricsGpuInfo {
            active_residency_pct: value.get("active_residency_pct").and_then(|v| v.as_f64()).map(|v| v as f32),
            frequency_mhz: value.get("frequency_mhz").and_then(|v| v.as_u64()),
            power_mw: value.get("power_mw").and_then(|v| v.as_u64()),
            backend: value.get("backend").and_then(|v| v.as_str()).map(|s| s.to_string()),
            notes: value.get("notes").and_then(|v| v.as_str()).map(|s| s.to_string()),
        })
    }

    fn extract_plist_real(s: &str, key: &str) -> Option<f64> {
        let needle = format!("<key>{}</key>", key);
        let start = s.find(&needle)? + needle.len();
        let rest = &s[start..];
        if let Some(idx) = rest.find("<real>") {
            let inner = &rest[idx + 6..];
            let end = inner.find("</real>")?;
            return inner[..end].trim().parse().ok();
        }
        if let Some(idx) = rest.find("<integer>") {
            let inner = &rest[idx + 9..];
            let end = inner.find("</integer>")?;
            return inner[..end].trim().parse().ok();
        }
        None
    }

    fn parse_leading_f32(s: &str) -> Option<f32> {
        let digits: String = s
            .chars()
            .skip_while(|c| c.is_whitespace())
            .take_while(|c| c.is_ascii_digit() || *c == '.' || *c == '-')
            .collect();
        if digits.is_empty() {
            None
        } else {
            digits.parse().ok()
        }
    }

    fn derive_used_memory_from_vram_free(perf: &str, total: Option<u64>) -> Option<u64> {
        let total = total?;
        let free = extract_object_u64(perf, "vramFreeBytes")?;
        Some(total.saturating_sub(free))
    }

}

#[cfg(target_os = "linux")]
mod platform {
    use super::{nvidia_smi, GpuInfo};
    use std::fs;
    use std::path::{Path, PathBuf};

    pub fn collect_static_all() -> Vec<GpuInfo> {
        gpu_cards().iter().map(|c| static_for(c)).collect()
    }

    pub fn collect_dynamic_all(base: &[GpuInfo]) -> Vec<GpuInfo> {
        let cards = gpu_cards();
        if cards.is_empty() {
            // No DRM node (VM/container) but nvidia-smi may still work.
            return nvidia_only_infos();
        }
        let nvidia = if cards.iter().any(|c| read_trimmed(c.join("device/vendor")).as_deref() == Some("0x10de")) {
            nvidia_smi::query_all()
        } else {
            Vec::new()
        };
        cards
            .iter()
            .map(|card| {
                let idx = card_index(card);
                let mut info = base
                    .iter()
                    .find(|b| b.adapter_index.is_some() && b.adapter_index == idx)
                    .cloned()
                    .unwrap_or_else(|| static_for(card));
                apply_sysfs_sample(&mut info, card, &nvidia);
                info
            })
            .collect()
    }

    fn static_for(card: &Path) -> GpuInfo {
        let card = card.to_path_buf();
        let vendor_id = read_trimmed(card.join("device/vendor"));
        let vendor = vendor_from_id(vendor_id.as_deref());
        let index = card_index(&card);
        let name = read_trimmed(card.join("device/label"))
            .or_else(|| read_trimmed(card.join("device/product_name")))
            .unwrap_or_else(|| match index {
                Some(i) => format!("{vendor} GPU (card{i})"),
                None => format!("{vendor} GPU"),
            });

        let mut info = GpuInfo {
            platform: "Linux".to_string(),
            name,
            vendor,
            adapter_index: index,
            backend: "linux-sysfs".to_string(),
            support_level: "partial".to_string(),
            collection_method: format!("{} + hwmon", card.display()),
            ..Default::default()
        };
        apply_sysfs_sample(&mut info, &card, &[]);
        info
    }

    /// PCI address of a DRM card, e.g. `0000:01:00.0`.
    fn pci_address(card: &Path) -> Option<String> {
        let target = fs::read_link(card.join("device")).ok()?;
        Some(target.file_name()?.to_string_lossy().to_string())
    }

    fn apply_sysfs_sample(info: &mut GpuInfo, card: &Path, nvidia: &[nvidia_smi::Sample]) {
        let dev = card.join("device");
        info.utilization_pct = read_percent(dev.join("gpu_busy_percent"));
        // i915 / xe have no busy file; derive it from engine busy counters.
        let mut busy_source = None;
        if info.utilization_pct.is_none() && info.vendor == "Intel" {
            let driver = fs::read_link(dev.join("driver"))
                .ok()
                .and_then(|t| t.file_name().map(|n| n.to_string_lossy().to_string()))
                .unwrap_or_default();
            if let Some((pct, source)) = pci_address(card).and_then(|addr| crate::drm_busy::busy_pct(&addr, &driver)) {
                info.utilization_pct = Some(pct);
                busy_source = Some(source);
            }
        }
        info.temperature_c = read_hwmon_temp_c(card);
        // amdgpu exposes VRAM usage directly.
        info.memory_used_bytes = read_u64(dev.join("mem_info_vram_used"));
        info.memory_total_bytes = read_u64(dev.join("mem_info_vram_total")).or(info.memory_total_bytes);
        info.frequency_mhz = read_amd_sclk_mhz(&dev)
            .or_else(|| read_u64(card.join("gt_act_freq_mhz")))
            .or_else(|| read_u64(card.join("gt_cur_freq_mhz")));
        info.backend = "linux-sysfs".to_string();
        info.collection_method = match busy_source {
            Some(source) => format!("{} + hwmon + {source}", card.display()),
            None => format!("{} + hwmon", card.display()),
        };

        // The proprietary NVIDIA driver exposes nothing useful in sysfs;
        // nvidia-smi ships with it and covers utilization, VRAM, and temps.
        if info.vendor == "NVIDIA" {
            let addr = pci_address(card);
            let sample = nvidia
                .iter()
                .find(|s| super::same_pci_device(s.bus_id.as_deref(), addr.as_deref()))
                // Single-GPU systems: no need for the bus id to line up.
                .or_else(|| if nvidia.len() == 1 { nvidia.first() } else { None });
            if let Some(sample) = sample {
                sample.apply_to(info);
                info.support_level = "full".to_string();
                info.notes = Some("NVIDIA telemetry from nvidia-smi.".to_string());
                return;
            }
        }

        let have_util = info.utilization_pct.is_some();
        let have_extra = info.temperature_c.is_some() || info.memory_used_bytes.is_some();
        info.support_level = if have_util && have_extra { "full" } else if have_util || have_extra { "partial" } else { "minimal" }.to_string();
        info.notes = Some(match (info.vendor.as_str(), have_util) {
            (_, true) if busy_source == Some("DRM fdinfo") => "Utilization from DRM fdinfo engine counters of the processes you can see (run as root, or allow perf events, for the system-wide i915 PMU); frequency and temperature from sysfs/hwmon.".to_string(),
            (_, true) if busy_source.is_some() => "Utilization from the i915 PMU engine counters; frequency and temperature from sysfs/hwmon.".to_string(),
            (_, true) => "Live telemetry from the DRM/sysfs + hwmon interfaces.".to_string(),
            ("NVIDIA", false) => "NVIDIA GPU found, but nvidia-smi was not available. Install the proprietary driver's utilities for live telemetry.".to_string(),
            ("Intel", false) => "Utilization needs DRM fdinfo engine stats (Linux 5.19+ for i915, 6.8+ for xe) or the i915 PMU; frequency and temperature are shown when available.".to_string(),
            _ => "This driver exposes only partial telemetry via sysfs/hwmon.".to_string(),
        });
    }

    fn nvidia_only_infos() -> Vec<GpuInfo> {
        nvidia_smi::query_all()
            .iter()
            .enumerate()
            .map(|(i, sample)| {
                let mut info = GpuInfo {
                    platform: "Linux".to_string(),
                    vendor: "NVIDIA".to_string(),
                    adapter_index: Some(i as u32),
                    support_level: "full".to_string(),
                    notes: Some("NVIDIA telemetry from nvidia-smi.".to_string()),
                    ..Default::default()
                };
                sample.apply_to(&mut info);
                info
            })
            .collect()
    }

    pub fn unsupported_info() -> Option<GpuInfo> {
        // No DRM node (VMs, containers, some remote sessions) — nvidia-smi can
        // still work there, e.g. with GPU passthrough.
        if let Some(info) = nvidia_only_infos().into_iter().next() {
            return Some(info);
        }
        Some(GpuInfo {
            platform: "Linux".to_string(),
            name: "GPU detected but metrics unavailable".to_string(),
            vendor: "Unknown".to_string(),
            backend: "linux-unavailable".to_string(),
            support_level: "unsupported".to_string(),
            notes: Some("No readable DRM/sysfs GPU node was found. This can happen in VMs, containers, remote sessions, or unsupported drivers.".to_string()),
            collection_method: "/sys/class/drm fallback".to_string(),
            ..Default::default()
        })
    }

    /// All GPU cards, most interesting first: discrete NVIDIA/AMD, then the
    /// boot display adapter, then the rest. simpledrm / virtual framebuffers
    /// (no PCI vendor) are skipped.
    fn gpu_cards() -> Vec<PathBuf> {
        let Ok(entries) = fs::read_dir("/sys/class/drm") else { return Vec::new() };
        let mut cards: Vec<(u8, u32, PathBuf)> = entries
            .flatten()
            .filter_map(|entry| {
                let name = entry.file_name().to_string_lossy().to_string();
                if !name.starts_with("card") || name.contains('-') {
                    return None;
                }
                let path = entry.path();
                let dev = path.join("device");
                if !dev.exists() {
                    return None;
                }
                let vendor = read_trimmed(dev.join("vendor"));
                let rank = match vendor.as_deref() {
                    Some("0x10de") => 4,
                    Some("0x1002") if dev.join("gpu_busy_percent").exists() => 4,
                    Some(_) if read_trimmed(dev.join("boot_vga")).as_deref() == Some("1") => 3,
                    Some(_) => 2,
                    None => 1,
                };
                Some((rank, card_index(&path).unwrap_or(u32::MAX), path))
            })
            .collect();
        cards.sort_by(|a, b| b.0.cmp(&a.0).then(a.1.cmp(&b.1)));
        cards.into_iter().filter(|(rank, _, _)| *rank > 1).map(|(_, _, p)| p).collect()
    }

    fn read_trimmed(path: PathBuf) -> Option<String> {
        fs::read_to_string(path).ok().map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
    }

    fn read_percent(path: PathBuf) -> Option<f32> {
        read_trimmed(path).and_then(|s| s.parse::<f32>().ok())
    }

    fn read_u64(path: PathBuf) -> Option<u64> {
        read_trimmed(path).and_then(|s| s.parse::<u64>().ok())
    }

    fn read_amd_sclk_mhz(dev: &Path) -> Option<u64> {
        super::parse_amd_dpm_active_mhz(&fs::read_to_string(dev.join("pp_dpm_sclk")).ok()?)
    }

    fn read_hwmon_temp_c(card: &Path) -> Option<f32> {
        let hwmon = card.join("device/hwmon");
        let entries = fs::read_dir(hwmon).ok()?;
        for entry in entries.flatten() {
            let temp = entry.path().join("temp1_input");
            if let Some(raw) = read_trimmed(temp) {
                if let Ok(milli_c) = raw.parse::<f32>() {
                    return Some(milli_c / 1000.0);
                }
            }
        }
        None
    }

    fn vendor_from_id(id: Option<&str>) -> String {
        match id {
            Some("0x1002") => "AMD".to_string(),
            Some("0x10de") => "NVIDIA".to_string(),
            Some("0x8086") => "Intel".to_string(),
            _ => "Unknown".to_string(),
        }
    }

    fn card_index(card: &Path) -> Option<u32> {
        let name = card.file_name()?.to_string_lossy();
        name.trim_start_matches("card").parse::<u32>().ok()
    }
}

#[cfg(target_os = "windows")]
mod platform {
    use super::{nvidia_smi, GpuInfo};
    use std::sync::Mutex;
    use windows::core::w;
    use windows::Wdk::Graphics::Direct3D::{
        D3DKMTCloseAdapter, D3DKMTOpenAdapterFromLuid, D3DKMTQueryAdapterInfo, D3DKMT_ADAPTER_PERFDATA, D3DKMT_CLOSEADAPTER,
        D3DKMT_OPENADAPTERFROMLUID, D3DKMT_QUERYADAPTERINFO, KMTQAITYPE_ADAPTERPERFDATA, KMTQAITYPE_PHYSICALADAPTERCOUNT,
    };
    use windows::Win32::Foundation::LUID;
    use windows::Win32::Graphics::Dxgi::{CreateDXGIFactory1, IDXGIAdapter1, IDXGIFactory1, DXGI_ADAPTER_FLAG_SOFTWARE};
    use windows::Win32::System::Performance::{
        PdhAddEnglishCounterW, PdhCloseQuery, PdhCollectQueryData, PdhGetFormattedCounterArrayW, PdhOpenQueryW,
        PDH_CSTATUS_NEW_DATA, PDH_CSTATUS_VALID_DATA, PDH_FMT, PDH_FMT_COUNTERVALUE_ITEM_W, PDH_FMT_DOUBLE, PDH_MORE_DATA,
    };

    fn static_for(adapter: &AdapterInfo) -> GpuInfo {
        GpuInfo {
            platform: "Windows".to_string(),
            name: adapter.name.clone(),
            vendor: adapter.vendor.clone(),
            memory_total_bytes: Some(adapter.memory_total()),
            adapter_index: Some(adapter.index),
            backend: "windows-dxgi".to_string(),
            support_level: "partial".to_string(),
            notes: Some("DXGI adapter discovery is live.".to_string()),
            collection_method: "DXGI adapter enumeration".to_string(),
            ..Default::default()
        }
    }

    pub fn collect_static_all() -> Vec<GpuInfo> {
        adapters().iter().map(static_for).collect()
    }

    pub fn collect_dynamic_all(base: &[GpuInfo]) -> Vec<GpuInfo> {
        let adapters = adapters();
        let tags: Vec<String> = adapters.iter().map(|a| a.luid_tag()).collect();
        // One PDH collection for all adapters: collecting per adapter would
        // shrink the rate counters' sampling window to microseconds.
        let samples = perf_counter_samples(&tags);
        let nvidia = if adapters.iter().any(|a| a.vendor == "NVIDIA") { nvidia_smi::query_all() } else { Vec::new() };
        let mut nvidia_used = vec![false; nvidia.len()];

        adapters
            .iter()
            .zip(samples)
            .map(|(adapter, (util, dedicated_used))| {
                let mut info = base
                    .iter()
                    .find(|b| b.adapter_index == Some(adapter.index))
                    .cloned()
                    .unwrap_or_else(|| static_for(adapter));
                info.name = adapter.name.clone();
                info.vendor = adapter.vendor.clone();
                info.memory_total_bytes = Some(adapter.memory_total());

                // Task Manager's GPU numbers come from these counters, so ours match it.
                info.utilization_pct = util;
                info.memory_used_bytes = dedicated_used.filter(|_| !adapter.is_integrated());
                // Driver-reported temperature (WDDM 2.4+): AMD, Intel Arc and
                // NVIDIA alike, without vendor SDKs. nvidia-smi overrides below.
                info.temperature_c = adapter_temperature_c(adapter);
                info.backend = "windows-dxgi-pdh".to_string();
                info.collection_method = "DXGI + PDH \\GPU Engine(*)\\Utilization Percentage".to_string();
                info.support_level = if util.is_some() { "full" } else { "partial" }.to_string();
                info.notes = Some(if util.is_some() {
                    let temp = if info.temperature_c.is_some() { ", and the driver-reported temperature" } else { "" };
                    format!("Utilization and dedicated memory from Windows GPU perf counters{temp} (same sources as Task Manager).")
                } else {
                    "DXGI adapter discovery is active; GPU Engine perf counters were unavailable in this session (they need WDDM 2.0+ drivers).".to_string()
                });

                if adapter.vendor == "NVIDIA" {
                    // DXGI has no PCI bus id; match nvidia-smi rows by name,
                    // then by order among the remaining NVIDIA adapters.
                    let pick = nvidia
                        .iter()
                        .enumerate()
                        .position(|(i, s)| !nvidia_used[i] && s.name.as_deref().is_some_and(|n| n.eq_ignore_ascii_case(&adapter.name)))
                        .or_else(|| nvidia_used.iter().position(|used| !used));
                    if let Some(i) = pick {
                        nvidia_used[i] = true;
                        let pdh_util = info.utilization_pct;
                        nvidia[i].apply_to(&mut info);
                        // Prefer PDH utilization for consistency with Task Manager.
                        info.utilization_pct = pdh_util.or(info.utilization_pct);
                        info.name = adapter.name.clone();
                        info.support_level = "full".to_string();
                        info.backend = "windows-dxgi-pdh+nvidia-smi".to_string();
                        info.notes = Some("Utilization from Windows GPU perf counters; temperature, clock, and VRAM from nvidia-smi.".to_string());
                    }
                }
                info
            })
            .collect()
    }

    pub fn unsupported_info() -> Option<GpuInfo> {
        Some(GpuInfo {
            platform: "Windows".to_string(),
            name: "Windows GPU adapter".to_string(),
            vendor: "Unknown".to_string(),
            backend: "windows-unavailable".to_string(),
            support_level: "unsupported".to_string(),
            notes: Some("DXGI adapter discovery failed. This can happen in headless sessions, unsupported VMs, or restricted environments.".to_string()),
            collection_method: "DXGI adapter enumeration".to_string(),
            ..Default::default()
        })
    }

    #[derive(Clone)]
    struct AdapterInfo {
        index: u32,
        name: String,
        vendor: String,
        dedicated_video_memory: u64,
        shared_system_memory: u64,
        luid_low: u32,
        luid_high: i32,
    }

    impl AdapterInfo {
        /// Integrated GPUs report a tiny (or zero) dedicated carve-out and
        /// actually use shared system memory.
        fn is_integrated(&self) -> bool {
            self.dedicated_video_memory < 512 * 1024 * 1024
        }

        /// Previously `max(dedicated, shared)`, which reported e.g. 16 GB for
        /// an 8 GB discrete card because shared memory is half of system RAM.
        fn memory_total(&self) -> u64 {
            if self.is_integrated() {
                self.shared_system_memory.max(self.dedicated_video_memory)
            } else {
                self.dedicated_video_memory
            }
        }

        fn luid_tag(&self) -> String {
            super::pdh_luid_tag(self.luid_high as u32, self.luid_low)
        }
    }

    /// Hardware adapters in DXGI order (the primary display adapter first).
    fn adapters() -> Vec<AdapterInfo> {
        let mut out = Vec::new();
        unsafe {
            let Ok(factory) = CreateDXGIFactory1::<IDXGIFactory1>() else { return out };
            let mut index = 0;
            loop {
                let adapter: IDXGIAdapter1 = match factory.EnumAdapters1(index) {
                    Ok(adapter) => adapter,
                    Err(_) => break,
                };
                index += 1;
                let Ok(desc) = adapter.GetDesc1() else { continue };
                let name = utf16_trimmed(&desc.Description);
                if desc.Flags & (DXGI_ADAPTER_FLAG_SOFTWARE.0 as u32) != 0
                    || name.to_ascii_lowercase().contains("microsoft basic render")
                {
                    continue;
                }
                out.push(AdapterInfo {
                    index: index - 1,
                    name: if name.is_empty() { "Windows GPU adapter".to_string() } else { name },
                    vendor: vendor_from_id(desc.VendorId),
                    dedicated_video_memory: desc.DedicatedVideoMemory as u64,
                    shared_system_memory: desc.SharedSystemMemory as u64,
                    luid_low: desc.AdapterLuid.LowPart,
                    luid_high: desc.AdapterLuid.HighPart,
                });
            }
        }
        out
    }

    /// Temperature from `D3DKMTQueryAdapterInfo(KMTQAITYPE_ADAPTERPERFDATA)`,
    /// which Task Manager shows under "GPU temperature". Drivers that don't
    /// implement it (older WDDM, many integrated GPUs) report 0 → `None`.
    /// Linked adapters (several physical GPUs behind one LUID) report the hottest.
    fn adapter_temperature_c(adapter: &AdapterInfo) -> Option<f32> {
        unsafe {
            let mut open = D3DKMT_OPENADAPTERFROMLUID {
                AdapterLuid: LUID { LowPart: adapter.luid_low, HighPart: adapter.luid_high },
                hAdapter: 0,
            };
            if D3DKMTOpenAdapterFromLuid(&mut open).is_err() {
                return None;
            }
            let mut physical_count: u32 = 0;
            let mut query = D3DKMT_QUERYADAPTERINFO {
                hAdapter: open.hAdapter,
                Type: KMTQAITYPE_PHYSICALADAPTERCOUNT,
                pPrivateDriverData: &mut physical_count as *mut u32 as *mut _,
                PrivateDriverDataSize: std::mem::size_of::<u32>() as u32,
            };
            if D3DKMTQueryAdapterInfo(&mut query).is_err() {
                physical_count = 1;
            }
            let mut hottest: Option<f32> = None;
            for index in 0..physical_count.clamp(1, 8) {
                let mut perf = D3DKMT_ADAPTER_PERFDATA { PhysicalAdapterIndex: index, ..Default::default() };
                let mut query = D3DKMT_QUERYADAPTERINFO {
                    hAdapter: open.hAdapter,
                    Type: KMTQAITYPE_ADAPTERPERFDATA,
                    pPrivateDriverData: &mut perf as *mut D3DKMT_ADAPTER_PERFDATA as *mut _,
                    PrivateDriverDataSize: std::mem::size_of::<D3DKMT_ADAPTER_PERFDATA>() as u32,
                };
                if D3DKMTQueryAdapterInfo(&mut query).is_ok() {
                    if let Some(t) = super::kmt_temperature_c(perf.Temperature) {
                        hottest = Some(hottest.map_or(t, |h| h.max(t)));
                    }
                }
            }
            let _ = D3DKMTCloseAdapter(&D3DKMT_CLOSEADAPTER { hAdapter: open.hAdapter });
            hottest
        }
    }

    fn utf16_trimmed(buf: &[u16]) -> String {
        let end = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
        String::from_utf16_lossy(&buf[..end]).trim().to_string()
    }

    // ── PDH perf counters ────────────────────────────────────────────────────

    /// Rate counters need two samples, so the query lives across calls.
    struct PdhGpuQuery {
        query: isize,
        engine: isize,
        dedicated: Option<isize>,
    }

    impl Drop for PdhGpuQuery {
        fn drop(&mut self) {
            unsafe {
                PdhCloseQuery(self.query);
            }
        }
    }

    enum PdhState {
        Uninit,
        Ready(PdhGpuQuery),
        Unavailable,
    }

    static PDH: Mutex<PdhState> = Mutex::new(PdhState::Uninit);

    fn open_query() -> Option<PdhGpuQuery> {
        unsafe {
            let mut query = 0isize;
            if PdhOpenQueryW(None, 0, &mut query) != 0 {
                return None;
            }
            let mut engine = 0isize;
            if PdhAddEnglishCounterW(query, w!("\\GPU Engine(*)\\Utilization Percentage"), 0, &mut engine) != 0 {
                PdhCloseQuery(query);
                return None;
            }
            let mut dedicated = 0isize;
            let dedicated = (PdhAddEnglishCounterW(query, w!("\\GPU Adapter Memory(*)\\Dedicated Usage"), 0, &mut dedicated) == 0)
                .then_some(dedicated);
            // Prime the rate counter; the first formatted read needs a baseline.
            PdhCollectQueryData(query);
            Some(PdhGpuQuery { query, engine, dedicated })
        }
    }

    fn read_counter_array(counter: isize) -> Option<Vec<(String, f64)>> {
        // Engine utilization can legitimately exceed 100 per instance before we
        // aggregate; don't let PDH clamp it.
        const PDH_FMT_NOCAP100: u32 = 0x0000_8000;
        let fmt = PDH_FMT(PDH_FMT_DOUBLE.0 | PDH_FMT_NOCAP100);
        unsafe {
            let mut size = 0u32;
            let mut count = 0u32;
            if PdhGetFormattedCounterArrayW(counter, fmt, &mut size, &mut count, None) != PDH_MORE_DATA {
                return None;
            }
            // u64 storage keeps the buffer aligned for the item structs.
            let mut buf = vec![0u64; (size as usize).div_ceil(8) + 1];
            let items = buf.as_mut_ptr() as *mut PDH_FMT_COUNTERVALUE_ITEM_W;
            if PdhGetFormattedCounterArrayW(counter, fmt, &mut size, &mut count, Some(items)) != 0 {
                return None;
            }
            let items = std::slice::from_raw_parts(items, count as usize);
            Some(
                items
                    .iter()
                    .filter(|it| it.FmtValue.CStatus == PDH_CSTATUS_VALID_DATA || it.FmtValue.CStatus == PDH_CSTATUS_NEW_DATA)
                    .filter_map(|it| Some((it.szName.to_string().ok()?, it.FmtValue.Anonymous.doubleValue)))
                    .collect(),
            )
        }
    }

    /// Utilization and dedicated-memory use for each adapter tag, from one
    /// PDH collection.
    fn perf_counter_samples(luid_tags: &[String]) -> Vec<(Option<f32>, Option<u64>)> {
        let empty = vec![(None, None); luid_tags.len()];
        let mut state = PDH.lock().unwrap_or_else(|p| p.into_inner());
        if matches!(*state, PdhState::Uninit) {
            *state = match open_query() {
                Some(q) => PdhState::Ready(q),
                None => PdhState::Unavailable,
            };
            // The first sample has no baseline yet.
            return empty;
        }
        let PdhState::Ready(q) = &*state else { return empty };
        if unsafe { PdhCollectQueryData(q.query) } != 0 {
            return empty;
        }
        let engines = read_counter_array(q.engine);
        let dedicated = q.dedicated.and_then(read_counter_array);
        luid_tags
            .iter()
            .map(|tag| {
                let util = engines.as_ref().and_then(|items| super::aggregate_engine_utilization(items, tag));
                let used = dedicated
                    .as_ref()
                    .map(|items| {
                        items
                            .iter()
                            .filter(|(name, _)| name.to_ascii_lowercase().contains(tag.as_str()))
                            .map(|(_, v)| *v as u64)
                            .sum::<u64>()
                    })
                    .filter(|v| *v > 0);
                (util, used)
            })
            .collect()
    }

    fn vendor_from_id(id: u32) -> String {
        match id {
            0x10DE => "NVIDIA".to_string(),
            0x1002 | 0x1022 => "AMD".to_string(),
            0x8086 => "Intel".to_string(),
            0x1414 => "Microsoft".to_string(),
            0x5143 => "Qualcomm".to_string(),
            _ => format!("PCI vendor {id:#06x}"),
        }
    }
}

// ─── Shared helpers (pure, unit-tested on every platform) ────────────────────

/// Instance-name fragment PDH uses for an adapter, e.g. `luid_0x00000000_0x0000d1b5`.
#[cfg_attr(not(windows), allow(dead_code))]
fn pdh_luid_tag(high: u32, low: u32) -> String {
    format!("luid_0x{high:08x}_0x{low:08x}")
}

/// Aggregate `\GPU Engine(*)\Utilization Percentage` the way Task Manager does:
/// sum all instances (processes) per engine type, then report the busiest
/// engine type. Instances look like
/// `pid_1234_luid_0x00000000_0x0000D1B5_phys_0_eng_0_engtype_3D`.
#[cfg_attr(not(windows), allow(dead_code))]
fn aggregate_engine_utilization(items: &[(String, f64)], luid_tag: &str) -> Option<f32> {
    use std::collections::HashMap;
    let mut per_engine: HashMap<String, f64> = HashMap::new();
    let mut matched = false;
    for (name, value) in items {
        let lower = name.to_ascii_lowercase();
        if !luid_tag.is_empty() && !lower.contains(luid_tag) {
            continue;
        }
        if !value.is_finite() {
            continue;
        }
        matched = true;
        let engine = lower.split("engtype_").nth(1).unwrap_or("unknown").to_string();
        *per_engine.entry(engine).or_default() += value;
    }
    if !matched {
        return None;
    }
    let busiest = per_engine.values().cloned().fold(0.0f64, f64::max);
    Some(busiest.clamp(0.0, 100.0) as f32)
}

/// Convert `D3DKMT_ADAPTER_PERFDATA::Temperature`. It is documented in
/// deci-Celsius, but some drivers have reported deci-Kelvin; the two ranges
/// can't overlap for a working GPU (>200 °C vs. <-73 °C), so accept both.
/// 0 means the driver doesn't report a temperature.
#[cfg_attr(not(windows), allow(dead_code))]
fn kmt_temperature_c(raw: u32) -> Option<f32> {
    let deci = raw as f32 / 10.0;
    let celsius = if deci >= 200.0 { deci - 273.15 } else { deci };
    (raw != 0 && celsius > 0.0 && celsius < 150.0).then_some(celsius)
}

/// Compare PCI addresses from nvidia-smi (`00000000:01:00.0`) and sysfs
/// (`0000:01:00.0`) by bus:device.function, ignoring the domain width.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn same_pci_device(a: Option<&str>, b: Option<&str>) -> bool {
    let key = |s: &str| s.rsplit_once(':').map(|(head, func)| {
        let bus = head.rsplit(':').next().unwrap_or(head);
        format!("{}:{}", bus.to_ascii_lowercase(), func.to_ascii_lowercase())
    });
    match (a.and_then(key), b.and_then(key)) {
        (Some(x), Some(y)) => x == y,
        _ => false,
    }
}

/// Parse amdgpu's `pp_dpm_sclk`, whose active level is marked with `*`:
/// `0: 500Mhz\n1: 1200Mhz *\n2: 2400Mhz`.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn parse_amd_dpm_active_mhz(text: &str) -> Option<u64> {
    let line = text.lines().find(|l| l.trim_end().ends_with('*'))?;
    let value = line.split(':').nth(1)?.trim().trim_end_matches('*').trim();
    let digits: String = value.chars().take_while(|c| c.is_ascii_digit()).collect();
    digits.parse().ok()
}

/// nvidia-smi ships with the NVIDIA driver on both Linux and Windows and is
/// the one vendor tool we can rely on without linking NVML.
#[cfg(any(target_os = "linux", target_os = "windows"))]
mod nvidia_smi {
    use super::GpuInfo;
    use std::io::Read;
    use std::process::{Command, Stdio};
    use std::sync::atomic::{AtomicU8, Ordering};
    use std::time::{Duration, Instant};

    const UNKNOWN: u8 = 0;
    const AVAILABLE: u8 = 1;
    const MISSING: u8 = 2;
    static STATE: AtomicU8 = AtomicU8::new(UNKNOWN);

    const QUERY: &str = "--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu,clocks.gr,pci.bus_id";

    pub struct Sample {
        pub name: Option<String>,
        pub utilization_pct: Option<f32>,
        pub memory_used_bytes: Option<u64>,
        pub memory_total_bytes: Option<u64>,
        pub temperature_c: Option<f32>,
        pub frequency_mhz: Option<u64>,
        /// e.g. `00000000:01:00.0`; used to match DRM cards on Linux (DXGI
        /// has no PCI address to compare against).
        #[cfg_attr(windows, allow(dead_code))]
        pub bus_id: Option<String>,
    }

    impl Sample {
        pub fn apply_to(&self, info: &mut GpuInfo) {
            if let Some(name) = &self.name {
                info.name = name.clone();
            }
            info.utilization_pct = self.utilization_pct.or(info.utilization_pct);
            info.memory_used_bytes = self.memory_used_bytes.or(info.memory_used_bytes);
            info.memory_total_bytes = self.memory_total_bytes.or(info.memory_total_bytes);
            info.temperature_c = self.temperature_c.or(info.temperature_c);
            info.frequency_mhz = self.frequency_mhz.or(info.frequency_mhz);
            info.backend = "nvidia-smi".to_string();
            info.collection_method = format!("nvidia-smi {QUERY}");
        }
    }

    /// One sample per NVIDIA GPU, in nvidia-smi's order.
    pub fn query_all() -> Vec<Sample> {
        if STATE.load(Ordering::Relaxed) == MISSING {
            return Vec::new();
        }
        match run(Duration::from_secs(2)) {
            Some(out) => {
                STATE.store(AVAILABLE, Ordering::Relaxed);
                out.lines().filter_map(parse_line).collect()
            }
            None => {
                // Stop spawning a missing binary every poll; a transient failure
                // after it has worked once is retried.
                if STATE.load(Ordering::Relaxed) == UNKNOWN {
                    STATE.store(MISSING, Ordering::Relaxed);
                }
                Vec::new()
            }
        }
    }

    fn command() -> Command {
        #[allow(unused_mut)]
        let mut cmd = Command::new(binary());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            // Don't flash a console window from a GUI app.
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }
        cmd
    }

    fn binary() -> String {
        #[cfg(windows)]
        {
            // Older drivers didn't put nvidia-smi on PATH.
            let legacy = r"C:\Program Files\NVIDIA Corporation\NVSMI\nvidia-smi.exe";
            if std::path::Path::new(legacy).exists() {
                return legacy.to_string();
            }
        }
        "nvidia-smi".to_string()
    }

    /// nvidia-smi can hang when the driver is wedged; never block the
    /// collector on it for more than `timeout`.
    fn run(timeout: Duration) -> Option<String> {
        let mut child = command()
            .args([QUERY, "--format=csv,noheader,nounits"])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .ok()?;
        let started = Instant::now();
        loop {
            match child.try_wait() {
                Ok(Some(status)) if status.success() => break,
                Ok(Some(_)) => return None,
                Ok(None) if started.elapsed() < timeout => std::thread::sleep(Duration::from_millis(20)),
                _ => {
                    let _ = child.kill();
                    let _ = child.wait();
                    return None;
                }
            }
        }
        let mut out = String::new();
        child.stdout.take()?.read_to_string(&mut out).ok()?;
        Some(out)
    }

    /// Parse one CSV row. Fields may be `[N/A]` / `[Not Supported]`.
    pub fn parse_line(line: &str) -> Option<Sample> {
        let fields: Vec<&str> = line.split(',').map(str::trim).collect();
        if fields.len() < 6 {
            return None;
        }
        let num = |s: &str| s.parse::<f64>().ok().filter(|v| v.is_finite());
        let mib = |s: &str| num(s).map(|v| (v * 1024.0 * 1024.0) as u64);
        Some(Sample {
            name: Some(fields[0].to_string()).filter(|n| !n.is_empty() && !n.starts_with('[')),
            utilization_pct: num(fields[1]).map(|v| v as f32),
            memory_used_bytes: mib(fields[2]),
            memory_total_bytes: mib(fields[3]),
            temperature_c: num(fields[4]).map(|v| v as f32),
            frequency_mhz: num(fields[5]).map(|v| v as u64),
            bus_id: fields.get(6).map(|s| s.to_string()).filter(|s| !s.is_empty() && !s.starts_with('[')),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn engine_utilization_matches_task_manager_semantics() {
        let tag = pdh_luid_tag(0, 0xD1B5);
        assert_eq!(tag, "luid_0x00000000_0x0000d1b5");
        let items = vec![
            ("pid_10_luid_0x00000000_0x0000D1B5_phys_0_eng_0_engtype_3D".to_string(), 20.0),
            ("pid_11_luid_0x00000000_0x0000D1B5_phys_0_eng_0_engtype_3D".to_string(), 15.0),
            ("pid_12_luid_0x00000000_0x0000D1B5_phys_0_eng_3_engtype_VideoDecode".to_string(), 30.0),
            // Different adapter — ignored.
            ("pid_13_luid_0x00000000_0x0000AAAA_phys_0_eng_0_engtype_3D".to_string(), 90.0),
        ];
        assert_eq!(aggregate_engine_utilization(&items, &tag), Some(35.0));
        assert_eq!(aggregate_engine_utilization(&items, "luid_0x00000000_0x0000ffff"), None);
        let saturated = vec![("luid_0x00000000_0x0000d1b5_engtype_3D".to_string(), 180.0)];
        assert_eq!(aggregate_engine_utilization(&saturated, &tag), Some(100.0));
    }

    #[test]
    fn kmt_temperature_units() {
        assert_eq!(kmt_temperature_c(0), None);
        assert_eq!(kmt_temperature_c(455), Some(45.5));
        // deci-Kelvin from drivers that report it that way
        assert!((kmt_temperature_c(3186).unwrap() - 45.45).abs() < 0.01);
        assert_eq!(kmt_temperature_c(u32::MAX), None);
    }

    #[test]
    fn pci_addresses_match_across_domain_widths() {
        assert!(same_pci_device(Some("00000000:01:00.0"), Some("0000:01:00.0")));
        assert!(same_pci_device(Some("00000000:0A:00.0"), Some("0000:0a:00.0")));
        assert!(!same_pci_device(Some("00000000:01:00.0"), Some("0000:02:00.0")));
        assert!(!same_pci_device(None, Some("0000:01:00.0")));
    }

    #[test]
    fn amd_dpm_parsing() {
        assert_eq!(parse_amd_dpm_active_mhz("0: 500Mhz\n1: 1200Mhz *\n2: 2400Mhz\n"), Some(1200));
        assert_eq!(parse_amd_dpm_active_mhz("0: 500Mhz\n1: 1200Mhz\n"), None);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_multi_gpu_parsing() {
        use platform::{accelerator_vendor, parse_system_profiler, split_ioreg_nodes, ProfilerGpu};
        let ioreg = r#"+-o AMDRadeonX5000_AMDNavi14GraphicsAccelerator  <class AMDRadeonX5000_AMDNavi14GraphicsAccelerator, id 0x100000a2c, registered, matched, active, busy 0 (0 ms), retain 30>
    {
      "IOClass" = "AMDRadeonX5000_AMDNavi14GraphicsAccelerator"
      "CFBundleIdentifier" = "com.apple.kext.AMDRadeonX5000"
      "PerformanceStatistics" = {"GPU Activity(%)"=37,"Temperature(C)"=61,"Core Clock(MHz)"=1300,"vramUsedBytes"=1073741824,"vramFreeBytes"=3221225472}
    }

+-o IntelAccelerator  <class IntelAccelerator, id 0x100000a30, registered, matched, active, busy 0 (0 ms), retain 20>
    {
      "IOClass" = "IntelAccelerator"
      "CFBundleIdentifier" = "com.apple.driver.AppleIntelKBLGraphics"
      "PerformanceStatistics" = {"Device Utilization %"=4,"In use system memory"=268435456}
    }
"#;
        let nodes = split_ioreg_nodes(ioreg);
        assert_eq!(nodes.len(), 2);
        assert_eq!(nodes[0].class, "AMDRadeonX5000_AMDNavi14GraphicsAccelerator");
        assert!(nodes[0].dump.contains("GPU Activity"));
        assert!(!nodes[0].dump.contains("IntelAccelerator"));
        assert_eq!(accelerator_vendor(&nodes[0]), "AMD");
        assert_eq!(accelerator_vendor(&nodes[1]), "Intel");

        let profiler = "Graphics/Displays:\n\n    Intel UHD Graphics 630:\n\n      Chipset Model: Intel UHD Graphics 630\n      Type: GPU\n      Bus: Built-In\n      VRAM (Dynamic, Max): 1536 MB\n      Vendor: Intel\n\n    AMD Radeon Pro 5500M:\n\n      Chipset Model: AMD Radeon Pro 5500M\n      Type: GPU\n      Bus: PCIe\n      VRAM (Total): 4 GB\n      Vendor: AMD (0x1002)\n";
        let gpus = parse_system_profiler(profiler);
        assert_eq!(gpus, vec![
            ProfilerGpu { name: Some("Intel UHD Graphics 630".into()), vendor: Some("Intel".into()), core_count: None, vram_bytes: Some(1536 * 1024 * 1024) },
            ProfilerGpu { name: Some("AMD Radeon Pro 5500M".into()), vendor: Some("AMD".into()), core_count: None, vram_bytes: Some(4 * 1024 * 1024 * 1024) },
        ]);
    }

    #[cfg(any(target_os = "linux", target_os = "windows"))]
    #[test]
    fn nvidia_smi_csv_parsing() {
        let s = nvidia_smi::parse_line("NVIDIA GeForce RTX 4070, 37, 2048, 12282, 54, 2475, 00000000:01:00.0").unwrap();
        assert_eq!(s.bus_id.as_deref(), Some("00000000:01:00.0"));
        assert_eq!(s.name.as_deref(), Some("NVIDIA GeForce RTX 4070"));
        assert_eq!(s.utilization_pct, Some(37.0));
        assert_eq!(s.memory_used_bytes, Some(2048 * 1024 * 1024));
        assert_eq!(s.memory_total_bytes, Some(12282 * 1024 * 1024));
        assert_eq!(s.temperature_c, Some(54.0));
        assert_eq!(s.frequency_mhz, Some(2475));

        let partial = nvidia_smi::parse_line("Tesla T4, [N/A], 0, 15360, [Not Supported], 300").unwrap();
        assert_eq!(partial.utilization_pct, None);
        assert_eq!(partial.temperature_c, None);
        assert!(nvidia_smi::parse_line("garbage").is_none());
    }
}

#[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
mod platform {
    use super::GpuInfo;

    pub fn collect_static_all() -> Vec<GpuInfo> {
        Vec::new()
    }

    pub fn collect_dynamic_all(_base: &[GpuInfo]) -> Vec<GpuInfo> {
        Vec::new()
    }

    pub fn unsupported_info() -> Option<GpuInfo> {
        Some(GpuInfo {
            platform: std::env::consts::OS.to_string(),
            name: "Unsupported GPU platform".to_string(),
            vendor: "Unknown".to_string(),
            core_count: None,
            utilization_pct: None,
            renderer_utilization_pct: None,
            tiler_utilization_pct: None,
            memory_used_bytes: None,
            memory_allocated_bytes: None,
            memory_driver_bytes: None,
            memory_total_bytes: None,
            temperature_c: None,
            power_state: None,
            frequency_mhz: None,
            last_submission_pid: None,
            adapter_index: None,
            backend: "unsupported".to_string(),
            support_level: "unsupported".to_string(),
            notes: Some("No GPU backend exists yet for this operating system.".to_string()),
            collection_method: "none".to_string(),
        })
    }
}
