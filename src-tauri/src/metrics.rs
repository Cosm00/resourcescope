use serde::Serialize;
use sysinfo::{Components, Disks, Networks, System};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::gpu::{GpuCollector, GpuInfo};

/// Full snapshot of system metrics — serialized to JSON and sent to frontend
#[derive(Serialize, Clone, Debug)]
pub struct MetricsSnapshot {
    pub timestamp: u64,
    pub cpu: CpuInfo,
    pub memory: MemInfo,
    pub gpu: Option<GpuInfo>,
    pub disks: Vec<DiskInfo>,
    pub networks: Vec<NetInfo>,
    pub processes: Vec<ProcessInfo>,
    pub health: HealthInfo,
}

#[derive(Serialize, Clone, Debug)]
pub struct CpuInfo {
    pub usage_pct: f32,
    pub core_usage: Vec<f32>,
    pub core_count: usize,
    pub model: String,
    pub load_avg: [f64; 3],
    pub frequency_mhz: u64,
}

#[derive(Serialize, Clone, Debug)]
pub struct MemInfo {
    pub total_bytes: u64,
    pub used_bytes: u64,
    pub available_bytes: u64,
    pub usage_pct: f32,
    pub swap_total_bytes: u64,
    pub swap_used_bytes: u64,
}

#[derive(Serialize, Clone, Debug)]
pub struct DiskInfo {
    pub name: String,
    pub mount_point: String,
    pub fs_type: String,
    pub total_bytes: u64,
    pub used_bytes: u64,
    pub available_bytes: u64,
    pub usage_pct: f32,
    pub is_removable: bool,
}

#[derive(Serialize, Clone, Debug)]
pub struct NetInfo {
    pub name: String,
    pub bytes_recv: u64,
    pub bytes_sent: u64,
    pub recv_bps: u64,
    pub sent_bps: u64,
}

#[derive(Serialize, Clone, Debug)]
pub struct ProcessInfo {
    pub pid: u32,
    pub name: String,
    pub cpu_pct: f32,
    pub mem_bytes: u64,
    pub status: String,
    pub parent_pid: Option<u32>,
    pub parent_name: Option<String>,
    pub exe_path: Option<String>,
    pub cwd: Option<String>,
    pub cmd: Vec<String>,
    pub user: Option<String>,
    pub app_name: String,
    pub process_kind: String,
    pub friendly_name: Option<String>,
    pub explanation: Option<String>,
    pub bundle_hint: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
pub struct HealthInfo {
    pub cpu_temp: Option<f32>,
    pub gpu_temp: Option<f32>,
    pub overall: String, // "good" | "warn" | "critical"
}

#[derive(Serialize, Clone, Debug)]
pub struct DirectoryUsage {
    pub path: String,
    pub name: String,
    pub bytes: u64,
    pub usage_pct_of_parent: f32,
    pub is_dir: bool,
}

#[derive(Serialize, Clone, Debug)]
pub struct DiskScanResult {
    pub root_path: String,
    pub total_bytes: u64,
    pub scanned_entries: usize,
    pub children: Vec<DirectoryUsage>,
}

// ─── Collector state ─────────────────────────────────────────────────────────

pub struct MetricsCollector {
    pub sys: System,
    pub disks: Disks,
    pub networks: Networks,
    pub components: Components,
    pub gpu: GpuCollector,
    prev_net: Option<(u64, Vec<(u64, u64)>)>, // (timestamp_ms, [(recv, sent)])
}

impl MetricsCollector {
    pub fn new() -> Self {
        let mut sys = System::new_all();
        sys.refresh_all();
        let disks = Disks::new_with_refreshed_list();
        let mut networks = Networks::new_with_refreshed_list();
        networks.refresh(false);
        let components = Components::new_with_refreshed_list();
        let gpu = GpuCollector::new();

        Self {
            sys,
            disks,
            networks,
            components,
            gpu,
            prev_net: None,
        }
    }

    pub fn collect(&mut self) -> MetricsSnapshot {
        // Refresh all subsystems
        self.sys.refresh_cpu_all();
        self.sys.refresh_memory();
        self.sys.refresh_processes(sysinfo::ProcessesToUpdate::All, true);
        self.disks.refresh(false);
        self.networks.refresh(false);
        self.components.refresh(false);

        let now_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;

        // ── CPU ──────────────────────────────────────────────────────────────
        let cpus = self.sys.cpus();
        let core_usage: Vec<f32> = cpus.iter().map(|c| c.cpu_usage()).collect();
        let usage_pct = if core_usage.is_empty() {
            0.0
        } else {
            core_usage.iter().sum::<f32>() / core_usage.len() as f32
        };
        let model = cpus.first().map(|c| c.brand().to_string()).unwrap_or_default();
        let frequency_mhz = cpus.first().map(|c| c.frequency()).unwrap_or(0);

        let load = System::load_average();
        let load_avg = [load.one, load.five, load.fifteen];

        // ── Memory ───────────────────────────────────────────────────────────
        let total_bytes = self.sys.total_memory();
        let used_bytes = self.sys.used_memory();
        let available_bytes = self.sys.available_memory();
        let usage_pct_mem = if total_bytes > 0 {
            (used_bytes as f32 / total_bytes as f32) * 100.0
        } else {
            0.0
        };
        let swap_total_bytes = self.sys.total_swap();
        let swap_used_bytes = self.sys.used_swap();

        // ── GPU ──────────────────────────────────────────────────────────────
        let gpu = self.gpu.collect();

        // ── Disks ────────────────────────────────────────────────────────────
        let disks: Vec<DiskInfo> = self.disks.iter().map(|d| {
            let total = d.total_space();
            let avail = d.available_space();
            let used = total.saturating_sub(avail);
            let usage_pct = if total > 0 {
                (used as f32 / total as f32) * 100.0
            } else {
                0.0
            };
            DiskInfo {
                name: d.name().to_string_lossy().to_string(),
                mount_point: d.mount_point().to_string_lossy().to_string(),
                fs_type: d.file_system().to_string_lossy().to_string(),
                total_bytes: total,
                used_bytes: used,
                available_bytes: avail,
                usage_pct,
                is_removable: d.is_removable(),
            }
        }).collect();

        // ── Networks ─────────────────────────────────────────────────────────
        let net_data: Vec<(String, u64, u64)> = self.networks.iter()
            .map(|(name, data)| (name.clone(), data.total_received(), data.total_transmitted()))
            .collect();

        let mut networks_info: Vec<NetInfo> = net_data.iter().enumerate().map(|(i, (name, recv, sent))| {
            let (recv_bps, sent_bps) = if let Some((prev_ts, ref prev_vals)) = self.prev_net {
                if let Some((prev_recv, prev_sent)) = prev_vals.get(i) {
                    let dt_secs = ((now_ms - prev_ts) as f64 / 1000.0).max(0.1);
                    let rbps = (recv.saturating_sub(*prev_recv) as f64 / dt_secs) as u64;
                    let sbps = (sent.saturating_sub(*prev_sent) as f64 / dt_secs) as u64;
                    (rbps, sbps)
                } else { (0, 0) }
            } else { (0, 0) };

            NetInfo {
                name: name.clone(),
                bytes_recv: *recv,
                bytes_sent: *sent,
                recv_bps,
                sent_bps,
            }
        }).collect();

        // Filter out loopback and zero-traffic interfaces in display, keep all in state
        networks_info.retain(|n| !n.name.starts_with("lo") && n.name != "lo0");

        self.prev_net = Some((
            now_ms,
            net_data.iter().map(|(_, r, s)| (*r, *s)).collect(),
        ));

        // ── Processes ────────────────────────────────────────────────────────
        let pid_to_name: HashMap<u32, String> = self.sys.processes().values()
            .map(|p| (p.pid().as_u32(), p.name().to_string_lossy().to_string()))
            .collect();

        let mut processes: Vec<ProcessInfo> = self.sys.processes().values()
            .map(|p| {
                let pid = p.pid().as_u32();
                let raw_name = p.name().to_string_lossy().to_string();
                let parent_pid = p.parent().map(|pp| pp.as_u32());
                let parent_name = parent_pid.and_then(|pp| pid_to_name.get(&pp).cloned());
                let exe_path = p.exe().map(|x| x.to_string_lossy().to_string());
                let cwd = p.cwd().map(|x| x.to_string_lossy().to_string());
                let cmd: Vec<String> = p.cmd().iter().map(|c| c.to_string_lossy().to_string()).collect();
                let user = p.user_id().map(|u| format!("{:?}", u));
                let app_name = infer_app_name(&raw_name, exe_path.as_deref(), parent_name.as_deref(), &cmd);
                let process_kind = infer_process_kind(&raw_name, exe_path.as_deref(), parent_name.as_deref());
                let friendly_name = friendly_name_for_process(&raw_name);
                let explanation = explanation_for_process(&raw_name, parent_name.as_deref(), exe_path.as_deref());
                let bundle_hint = infer_bundle_hint(exe_path.as_deref(), &cmd);

                ProcessInfo {
                    pid,
                    name: raw_name,
                    cpu_pct: p.cpu_usage(),
                    mem_bytes: p.memory(),
                    status: format!("{:?}", p.status()),
                    parent_pid,
                    parent_name,
                    exe_path,
                    cwd,
                    cmd,
                    user,
                    app_name,
                    process_kind,
                    friendly_name,
                    explanation,
                    bundle_hint,
                }
            })
            .collect();
        processes.sort_by(|a, b| {
            b.cpu_pct.partial_cmp(&a.cpu_pct)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| b.mem_bytes.cmp(&a.mem_bytes))
        });
        processes.truncate(80);

        // ── Health / Temperatures ─────────────────────────────────────────────
        let cpu_temp: Option<f32> = self.components.iter()
            .find(|c| {
                let label = c.label().to_lowercase();
                label.contains("cpu") || label.contains("core") || label.contains("package")
            })
            .and_then(|c| c.temperature());

        let gpu_temp = gpu.as_ref().and_then(|g| g.temperature_c);
        let gpu_util = gpu.as_ref().and_then(|g| g.utilization_pct).unwrap_or(0.0);

        let overall = if usage_pct > 90.0 || cpu_temp.is_some_and(|t| t > 95.0) || gpu_util > 95.0 || gpu_temp.is_some_and(|t| t > 95.0) {
            "critical"
        } else if usage_pct > 70.0 || cpu_temp.is_some_and(|t| t > 80.0) || gpu_util > 85.0 || gpu_temp.is_some_and(|t| t > 85.0) {
            "warn"
        } else {
            "good"
        }.to_string();

        MetricsSnapshot {
            timestamp: now_ms,
            cpu: CpuInfo {
                usage_pct,
                core_usage,
                core_count: cpus.len(),
                model,
                load_avg,
                frequency_mhz,
            },
            memory: MemInfo {
                total_bytes,
                used_bytes,
                available_bytes,
                usage_pct: usage_pct_mem,
                swap_total_bytes,
                swap_used_bytes,
            },
            gpu,
            disks,
            networks: networks_info,
            processes,
            health: HealthInfo {
                cpu_temp,
                gpu_temp,
                overall,
            },
        }
    }
}

fn infer_process_kind(name: &str, exe_path: Option<&str>, parent_name: Option<&str>) -> String {
    let lower = name.to_lowercase();
    let exe = exe_path.unwrap_or("").to_lowercase();
    let parent = parent_name.unwrap_or("").to_lowercase();
    if exe.contains("/system/") || exe.contains("/usr/libexec/") || exe.contains("/system/library/") || lower.ends_with('d') {
        "system-service".to_string()
    } else if exe.contains(".app/") {
        "app-process".to_string()
    } else if parent.ends_with("helper") || parent.contains("helper") || lower.contains("helper") {
        "helper-process".to_string()
    } else if exe.starts_with("/opt/homebrew") || exe.starts_with("/usr/local") {
        "cli-tool".to_string()
    } else {
        "background-process".to_string()
    }
}

fn infer_app_name(name: &str, exe_path: Option<&str>, parent_name: Option<&str>, cmd: &[String]) -> String {
    if let Some(path) = exe_path {
        if let Some(app) = app_name_from_path(path) {
            return app;
        }
    }
    if let Some(parent) = parent_name {
        if !parent.is_empty() && parent != name {
            return parent.to_string();
        }
    }
    if let Some(first) = cmd.first() {
        if let Some(app) = app_name_from_path(first) {
            return app;
        }
    }
    friendly_name_for_process(name).unwrap_or_else(|| name.to_string())
}

fn app_name_from_path(path: &str) -> Option<String> {
    let p = Path::new(path);
    let components: Vec<String> = p.iter().map(|s| s.to_string_lossy().to_string()).collect();
    for part in components {
        if part.ends_with(".app") {
            return Some(part.trim_end_matches(".app").to_string());
        }
    }
    None
}

fn infer_bundle_hint(exe_path: Option<&str>, cmd: &[String]) -> Option<String> {
    exe_path.and_then(app_name_from_path).or_else(|| cmd.first().and_then(|c| app_name_from_path(c)))
}

fn friendly_name_for_process(name: &str) -> Option<String> {
    match name.to_lowercase().as_str() {
        "mediaanalysisd" => Some("Apple media analysis service".to_string()),
        "mds" => Some("Spotlight metadata server".to_string()),
        "mdworker_shared" => Some("Spotlight indexing worker".to_string()),
        "corespotlightd" => Some("Core Spotlight indexing service".to_string()),
        "photoanalysisd" => Some("Photos analysis service".to_string()),
        "cloudd" => Some("iCloud sync service".to_string()),
        "kernel_task" => Some("macOS kernel task".to_string()),
        "windowserver" => Some("macOS window compositor".to_string()),
        "distnoted" => Some("Distributed notifications service".to_string()),
        _ => None,
    }
}

fn explanation_for_process(name: &str, parent_name: Option<&str>, exe_path: Option<&str>) -> Option<String> {
    let lower = name.to_lowercase();
    let parent = parent_name.unwrap_or("");
    let exe = exe_path.unwrap_or("");
    let msg = match lower.as_str() {
        "mediaanalysisd" => "Usually triggered by Photos, Spotlight, or macOS media indexing/analysis jobs. High CPU often means the system is scanning or classifying images/video in the background.",
        "mds" | "mdworker_shared" | "corespotlightd" => "This is part of Spotlight indexing. High CPU or memory usually means files are being indexed or re-indexed.",
        "photoanalysisd" => "Background photo analysis for the Photos library. Can spike when importing or reprocessing media.",
        "cloudd" => "Handles iCloud sync. High usage usually means active syncing or conflict resolution.",
        "kernel_task" => "macOS kernel process. High CPU here can sometimes indicate thermal throttling or drivers pushing work into the kernel.",
        "windowserver" => "Draws the macOS UI. High usage often comes from many windows, displays, animations, or screen capture apps.",
        _ if exe.contains(".app/") => "This process belongs to a desktop app bundle. Open details to inspect the bundle/app path and parent process.",
        _ if lower.ends_with('d') => "This looks like a background daemon/service. Check the parent process and executable path for attribution.",
        _ if !parent.is_empty() => return Some(format!("Likely related to parent process: {parent}.")),
        _ => return None,
    };
    Some(msg.to_string())
}

fn dir_size_limited(path: &Path, depth: usize) -> u64 {
    if depth == 0 {
        return 0;
    }
    let mut total = 0u64;
    if let Ok(meta) = fs::symlink_metadata(path) {
        if meta.is_file() {
            return meta.len();
        }
    }
    if let Ok(read_dir) = fs::read_dir(path) {
        for entry in read_dir.flatten() {
            let child = entry.path();
            if let Ok(meta) = fs::symlink_metadata(&child) {
                if meta.is_file() {
                    total = total.saturating_add(meta.len());
                } else if meta.is_dir() {
                    total = total.saturating_add(dir_size_limited(&child, depth - 1));
                }
            }
        }
    }
    total
}

pub fn scan_directory_usage(root_path: &str) -> DiskScanResult {
    let root = PathBuf::from(root_path);
    let mut children = Vec::new();
    let mut total_bytes = 0u64;

    if let Ok(read_dir) = fs::read_dir(&root) {
        for entry in read_dir.flatten() {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            if let Ok(meta) = fs::symlink_metadata(&path) {
                let is_dir = meta.is_dir();
                let bytes = if meta.is_file() {
                    meta.len()
                } else if is_dir {
                    dir_size_limited(&path, 3)
                } else {
                    0
                };
                total_bytes = total_bytes.saturating_add(bytes);
                children.push(DirectoryUsage {
                    path: path.to_string_lossy().to_string(),
                    name,
                    bytes,
                    usage_pct_of_parent: 0.0,
                    is_dir,
                });
            }
        }
    }

    for child in &mut children {
        child.usage_pct_of_parent = if total_bytes > 0 {
            (child.bytes as f32 / total_bytes as f32) * 100.0
        } else {
            0.0
        };
    }

    children.sort_by(|a, b| b.bytes.cmp(&a.bytes));
    children.truncate(40);

    DiskScanResult {
        root_path: root.to_string_lossy().to_string(),
        total_bytes,
        scanned_entries: children.len(),
        children,
    }
}
