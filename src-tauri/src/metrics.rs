use serde::Serialize;
use sysinfo::{Components, Disks, Networks, System};
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
}

#[derive(Serialize, Clone, Debug)]
pub struct HealthInfo {
    pub cpu_temp: Option<f32>,
    pub gpu_temp: Option<f32>,
    pub overall: String, // "good" | "warn" | "critical"
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
        let mut processes: Vec<ProcessInfo> = self.sys.processes().values()
            .map(|p| ProcessInfo {
                pid: p.pid().as_u32(),
                name: p.name().to_string_lossy().to_string(),
                cpu_pct: p.cpu_usage(),
                mem_bytes: p.memory(),
                status: format!("{:?}", p.status()),
            })
            .collect();
        processes.sort_by(|a, b| b.cpu_pct.partial_cmp(&a.cpu_pct).unwrap_or(std::cmp::Ordering::Equal));
        processes.truncate(50);

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
