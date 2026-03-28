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
    pub temperature_c: Option<f32>,
    pub power_state: Option<u64>,
    pub last_submission_pid: Option<u32>,
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
        let static_info = platform::collect_static_info();
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
    const GPU_NODE: &str = "AGXAcceleratorG16G";

    pub fn collect_static_info() -> Option<GpuInfo> {
        let output = run_ioreg()?;
        let name = extract_quoted_value(&output, "model").unwrap_or_else(|| "Apple GPU".to_string());
        let core_count = extract_u64_value(&output, "gpu-core-count").map(|v| v as usize);

        Some(GpuInfo {
            platform: "macOS".to_string(),
            name,
            vendor: "Apple".to_string(),
            core_count,
            utilization_pct: None,
            renderer_utilization_pct: None,
            tiler_utilization_pct: None,
            memory_used_bytes: None,
            memory_allocated_bytes: None,
            memory_driver_bytes: None,
            temperature_c: None,
            power_state: extract_nested_u64_value(&output, "IOPowerManagement", "CurrentPowerState"),
            last_submission_pid: None,
            collection_method: "ioreg AGXAcceleratorG16G PerformanceStatistics".to_string(),
        })
    }

    pub fn collect_dynamic_info(base: Option<&GpuInfo>) -> Option<GpuInfo> {
        let output = run_ioreg()?;
        let mut info = base.cloned().unwrap_or_else(|| GpuInfo {
            platform: "macOS".to_string(),
            name: extract_quoted_value(&output, "model").unwrap_or_else(|| "Apple GPU".to_string()),
            vendor: "Apple".to_string(),
            core_count: extract_u64_value(&output, "gpu-core-count").map(|v| v as usize),
            utilization_pct: None,
            renderer_utilization_pct: None,
            tiler_utilization_pct: None,
            memory_used_bytes: None,
            memory_allocated_bytes: None,
            memory_driver_bytes: None,
            temperature_c: None,
            power_state: None,
            last_submission_pid: None,
            collection_method: "ioreg AGXAcceleratorG16G PerformanceStatistics".to_string(),
        });

        let perf = extract_braced_object(&output, "PerformanceStatistics")?;
        info.utilization_pct = extract_object_f32(&perf, "Device Utilization %");
        info.renderer_utilization_pct = extract_object_f32(&perf, "Renderer Utilization %");
        info.tiler_utilization_pct = extract_object_f32(&perf, "Tiler Utilization %");
        info.memory_used_bytes = extract_object_u64(&perf, "In use system memory");
        info.memory_allocated_bytes = extract_object_u64(&perf, "Alloc system memory");
        info.memory_driver_bytes = extract_object_u64(&perf, "In use system memory (driver)");
        info.power_state = extract_nested_u64_value(&output, "IOPowerManagement", "CurrentPowerState");
        info.last_submission_pid = extract_nested_u64_value(&output, "AGCInfo", "fLastSubmissionPID").map(|v| v as u32);
        info.temperature_c = None;

        Some(info)
    }

    fn run_ioreg() -> Option<String> {
        let output = Command::new(IOREG_PATH)
            .args(["-r", "-n", GPU_NODE, "-l"])
            .output()
            .ok()?;
        if !output.status.success() {
            return None;
        }
        String::from_utf8(output.stdout).ok()
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

#[cfg(not(target_os = "macos"))]
mod platform {
    use super::GpuInfo;

    pub fn collect_static_info() -> Option<GpuInfo> {
        None
    }

    pub fn collect_dynamic_info(_base: Option<&GpuInfo>) -> Option<GpuInfo> {
        None
    }
}
