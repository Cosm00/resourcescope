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
    pub last_submission_pid: Option<u32>,
    pub adapter_index: Option<u32>,
    pub backend: String,
    pub support_level: String,
    pub notes: Option<String>,
    pub collection_method: String,
}

pub struct GpuCollector {
    static_info: Option<GpuInfo>,
    cached_info: Option<GpuInfo>,
    last_refresh: Option<Instant>,
    refresh_interval: Duration,
}

impl GpuCollector {
    pub fn new() -> Self {
        let static_info = platform::collect_static_info().or_else(platform::unsupported_info);
        Self {
            cached_info: static_info.clone(),
            static_info,
            last_refresh: None,
            refresh_interval: Duration::from_secs(3),
        }
    }

    pub fn collect(&mut self) -> Option<GpuInfo> {
        let should_refresh = self
            .last_refresh
            .map(|t| t.elapsed() >= self.refresh_interval)
            .unwrap_or(true);

        if should_refresh {
            if let Some(dynamic) = platform::collect_dynamic_info(self.static_info.as_ref()) {
                self.cached_info = Some(dynamic);
            }
            self.last_refresh = Some(Instant::now());
        }

        self.cached_info.clone()
    }
}

#[cfg(target_os = "macos")]
mod platform {
    use super::GpuInfo;
    use std::process::Command;

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

    pub fn collect_static_info() -> Option<GpuInfo> {
        let (class_name, output) = find_gpu_ioreg_dump()?;
        let vendor = infer_vendor(&output);
        let name = extract_quoted_value(&output, "model")
            .or_else(|| extract_quoted_value(&output, "CFBundleName"))
            .or_else(|| infer_name_from_class(&class_name, &vendor))
            .unwrap_or_else(|| format!("{} GPU", vendor));
        let core_count = extract_u64_value(&output, "gpu-core-count")
            .or_else(|| extract_u64_value(&output, "num_cores"))
            .map(|v| v as usize);

        Some(GpuInfo {
            platform: "macOS".to_string(),
            name,
            vendor,
            core_count,
            utilization_pct: None,
            renderer_utilization_pct: None,
            tiler_utilization_pct: None,
            memory_used_bytes: None,
            memory_allocated_bytes: None,
            memory_driver_bytes: None,
            memory_total_bytes: extract_u64_value(&output, "recommendedMaxWorkingSetSize"),
            temperature_c: None,
            power_state: extract_nested_u64_value(&output, "IOPowerManagement", "CurrentPowerState"),
            last_submission_pid: None,
            adapter_index: Some(0),
            backend: "macos-ioreg".to_string(),
            support_level: if output.contains("PerformanceStatistics") {
                "full".to_string()
            } else {
                "partial".to_string()
            },
            notes: Some(format!("Discovered GPU IORegistry node via class {class_name}.")),
            collection_method: format!("ioreg -r -n {class_name} -l"),
        })
    }

    pub fn collect_dynamic_info(base: Option<&GpuInfo>) -> Option<GpuInfo> {
        let (class_name, output) = find_gpu_ioreg_dump()?;
        let mut info = base.cloned().unwrap_or_else(|| GpuInfo {
            platform: "macOS".to_string(),
            name: infer_name_from_class(&class_name, &infer_vendor(&output)).unwrap_or_else(|| "Apple GPU".to_string()),
            vendor: infer_vendor(&output),
            core_count: extract_u64_value(&output, "gpu-core-count").map(|v| v as usize),
            utilization_pct: None,
            renderer_utilization_pct: None,
            tiler_utilization_pct: None,
            memory_used_bytes: None,
            memory_allocated_bytes: None,
            memory_driver_bytes: None,
            memory_total_bytes: extract_u64_value(&output, "recommendedMaxWorkingSetSize"),
            temperature_c: None,
            power_state: None,
            last_submission_pid: None,
            adapter_index: Some(0),
            backend: "macos-ioreg".to_string(),
            support_level: "partial".to_string(),
            notes: None,
            collection_method: format!("ioreg -r -n {class_name} -l"),
        });

        if let Some(perf) = extract_braced_object(&output, "PerformanceStatistics") {
            info.utilization_pct = extract_object_f32(&perf, "Device Utilization %")
                .or_else(|| extract_object_f32(&perf, "GPU Core Utilization"));
            info.renderer_utilization_pct = extract_object_f32(&perf, "Renderer Utilization %");
            info.tiler_utilization_pct = extract_object_f32(&perf, "Tiler Utilization %");
            info.memory_used_bytes = extract_object_u64(&perf, "In use system memory");
            info.memory_allocated_bytes = extract_object_u64(&perf, "Alloc system memory");
            info.memory_driver_bytes = extract_object_u64(&perf, "In use system memory (driver)");
            info.support_level = "full".to_string();
        }

        info.memory_total_bytes = info
            .memory_total_bytes
            .or_else(|| extract_u64_value(&output, "recommendedMaxWorkingSetSize"));
        info.power_state = extract_nested_u64_value(&output, "IOPowerManagement", "CurrentPowerState");
        info.last_submission_pid = extract_nested_u64_value(&output, "AGCInfo", "fLastSubmissionPID").map(|v| v as u32);
        info.notes = Some(format!("Using discovered IORegistry class {class_name}. Temperature is not exposed by this backend."));
        info.collection_method = format!("ioreg -r -n {class_name} -l");

        Some(info)
    }

    pub fn unsupported_info() -> Option<GpuInfo> {
        None
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
}

#[cfg(target_os = "linux")]
mod platform {
    use super::GpuInfo;
    use std::fs;
    use std::path::{Path, PathBuf};

    pub fn collect_static_info() -> Option<GpuInfo> {
        let card = first_gpu_card()?;
        let vendor_id = read_trimmed(card.join("device/vendor"));
        let vendor = vendor_from_id(vendor_id.as_deref());
        let name = read_trimmed(card.join("device/label"))
            .or_else(|| card.file_name().map(|n| n.to_string_lossy().to_string()))
            .unwrap_or_else(|| format!("{vendor} GPU"));

        Some(GpuInfo {
            platform: "Linux".to_string(),
            name,
            vendor,
            core_count: None,
            utilization_pct: read_percent(card.join("device/gpu_busy_percent")),
            renderer_utilization_pct: None,
            tiler_utilization_pct: None,
            memory_used_bytes: None,
            memory_allocated_bytes: None,
            memory_driver_bytes: None,
            memory_total_bytes: None,
            temperature_c: read_hwmon_temp_c(&card),
            power_state: None,
            last_submission_pid: None,
            adapter_index: card_index(&card),
            backend: "linux-sysfs".to_string(),
            support_level: "partial".to_string(),
            notes: Some("Linux GPU metrics currently use DRM/sysfs + hwmon when available; utilization is best on AMD, temperature depends on driver exposure.".to_string()),
            collection_method: format!("{} + hwmon", card.display()),
        })
    }

    pub fn collect_dynamic_info(base: Option<&GpuInfo>) -> Option<GpuInfo> {
        let card = first_gpu_card()?;
        let mut info = base.cloned().or_else(collect_static_info)?;
        info.utilization_pct = read_percent(card.join("device/gpu_busy_percent")).or(info.utilization_pct);
        info.temperature_c = read_hwmon_temp_c(&card).or(info.temperature_c);
        info.notes = Some("Partial Linux collector: sysfs/hwmon found. For richer NVIDIA/Intel metrics, add vendor-specific backends later.".to_string());
        Some(info)
    }

    pub fn unsupported_info() -> Option<GpuInfo> {
        Some(GpuInfo {
            platform: "Linux".to_string(),
            name: "GPU detected but metrics unavailable".to_string(),
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
            last_submission_pid: None,
            adapter_index: None,
            backend: "linux-unavailable".to_string(),
            support_level: "unsupported".to_string(),
            notes: Some("No readable DRM/sysfs GPU node was found. This can happen in VMs, containers, remote sessions, or unsupported drivers.".to_string()),
            collection_method: "/sys/class/drm fallback".to_string(),
        })
    }

    fn first_gpu_card() -> Option<PathBuf> {
        let drm = Path::new("/sys/class/drm");
        let entries = fs::read_dir(drm).ok()?;
        for entry in entries.flatten() {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            if !name.starts_with("card") || name.contains('-') {
                continue;
            }
            if path.join("device").exists() {
                return Some(path);
            }
        }
        None
    }

    fn read_trimmed(path: PathBuf) -> Option<String> {
        fs::read_to_string(path).ok().map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
    }

    fn read_percent(path: PathBuf) -> Option<f32> {
        read_trimmed(path).and_then(|s| s.parse::<f32>().ok())
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
    use super::GpuInfo;

    pub fn collect_static_info() -> Option<GpuInfo> {
        Some(GpuInfo {
            platform: "Windows".to_string(),
            name: "Windows GPU adapter".to_string(),
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
            last_submission_pid: None,
            adapter_index: Some(0),
            backend: "windows-placeholder".to_string(),
            support_level: "partial".to_string(),
            notes: Some("Windows GPU support is scaffolded but not yet querying DXGI / NVML / ADL. This placeholder keeps the UI honest while the backend matures.".to_string()),
            collection_method: "placeholder backend".to_string(),
        })
    }

    pub fn collect_dynamic_info(base: Option<&GpuInfo>) -> Option<GpuInfo> {
        base.cloned().or_else(collect_static_info)
    }

    pub fn unsupported_info() -> Option<GpuInfo> {
        collect_static_info()
    }
}

#[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
mod platform {
    use super::GpuInfo;

    pub fn collect_static_info() -> Option<GpuInfo> {
        None
    }

    pub fn collect_dynamic_info(_base: Option<&GpuInfo>) -> Option<GpuInfo> {
        None
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
            last_submission_pid: None,
            adapter_index: None,
            backend: "unsupported".to_string(),
            support_level: "unsupported".to_string(),
            notes: Some("No GPU backend exists yet for this operating system.".to_string()),
            collection_method: "none".to_string(),
        })
    }
}
