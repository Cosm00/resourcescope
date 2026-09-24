use serde::Serialize;
use sysinfo::{
    Components, Disks, Networks, ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind, Users,
};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use crate::battery::{BatteryCollector, BatteryInfo};
use crate::gpu::{GpuCollector, GpuInfo};
use crate::processes::{build_process_details, build_process_info, select_top_processes, ProcessDetails, ProcessInfo};

/// Full snapshot of system metrics — serialized to JSON and sent to frontend
#[derive(Serialize, Clone, Debug)]
pub struct MetricsSnapshot {
    pub timestamp: u64,
    pub cpu: CpuInfo,
    pub memory: MemInfo,
    pub gpu: Option<GpuInfo>,
    /// Empty on machines without a battery.
    pub batteries: Vec<BatteryInfo>,
    pub disks: Vec<DiskInfo>,
    pub networks: Vec<NetInfo>,
    pub processes: Vec<ProcessInfo>,
    /// Total processes on the system; `processes` may be a subset.
    pub process_count: usize,
    /// True when `processes` only holds the busiest processes (the UI asks
    /// for the full list only while the Processes tab is open).
    pub processes_truncated: bool,
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
    pub read_bps: u64,
    pub write_bps: u64,
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
    /// True when the scan hit its entry or time budget, so sizes are lower bounds.
    pub truncated: bool,
    /// Path segments from the filesystem root to `root_path`, each with the
    /// full path it represents. Built natively so the UI never has to guess
    /// the platform's path separator or drive/UNC prefix.
    pub breadcrumbs: Vec<PathCrumb>,
}

#[derive(Serialize, Clone, Debug)]
pub struct PathCrumb {
    pub name: String,
    pub path: String,
}

/// Wall-clock milliseconds since the Unix epoch.
pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

// ─── Collector state ─────────────────────────────────────────────────────────

pub struct MetricsCollector {
    pub sys: System,
    pub disks: Disks,
    pub networks: Networks,
    pub components: Components,
    pub gpu: GpuCollector,
    battery: BatteryCollector,
    users: Users,
    users_refreshed_at: Instant,
    // Keyed by interface name: sysinfo's iteration order is not guaranteed to
    // be stable when interfaces come and go (VPNs, docking, Wi-Fi toggles).
    prev_net: Option<(Instant, NetCounters)>,
    /// When the previous collect ran, for turning per-refresh byte counts
    /// (process and disk I/O) into rates.
    last_collect: Option<Instant>,
    /// Send every process instead of the busiest subset.
    pub full_process_list: bool,
}

/// Cumulative (received, transmitted) byte counters per interface name.
type NetCounters = HashMap<String, (u64, u64)>;

/// Processes are refreshed with the fields the UI shows. sysinfo's default
/// `refresh_processes` only loads cmd/cwd/user at construction time, which left
/// them empty for every process started after ResourceScope launched.
fn process_refresh_kind() -> ProcessRefreshKind {
    ProcessRefreshKind::nothing()
        .with_cpu()
        .with_memory()
        .with_exe(UpdateKind::OnlyIfNotSet)
        .with_cmd(UpdateKind::OnlyIfNotSet)
        .with_cwd(UpdateKind::OnlyIfNotSet)
        .with_user(UpdateKind::OnlyIfNotSet)
        .with_disk_usage()
}

const USERS_REFRESH_EVERY: Duration = Duration::from_secs(60);

impl MetricsCollector {
    pub fn new() -> Self {
        let mut sys = System::new_all();
        sys.refresh_all();
        let disks = Disks::new_with_refreshed_list();
        let mut networks = Networks::new_with_refreshed_list();
        networks.refresh(false);
        let components = Components::new_with_refreshed_list();
        let gpu = GpuCollector::new();
        let users = Users::new_with_refreshed_list();

        Self {
            sys,
            disks,
            networks,
            components,
            gpu,
            battery: BatteryCollector::new(),
            users,
            users_refreshed_at: Instant::now(),
            prev_net: None,
            last_collect: None,
            full_process_list: false,
        }
    }

    /// Refresh a single process (used before acting on it) without touching
    /// the rest of the table, so the next tick's CPU deltas stay accurate.
    pub fn refresh_process(&mut self, pid: sysinfo::Pid) {
        self.sys
            .refresh_processes_specifics(ProcessesToUpdate::Some(&[pid]), true, process_refresh_kind());
    }

    pub fn process_details(&mut self, pid: u32) -> Result<ProcessDetails, String> {
        let target = sysinfo::Pid::from_u32(pid);
        self.refresh_process(target);
        let process = self
            .sys
            .process(target)
            .ok_or_else(|| format!("Process {pid} is no longer running"))?;
        let mut pid_to_name = HashMap::new();
        if let Some(parent) = process.parent().and_then(|pp| self.sys.process(pp)) {
            pid_to_name.insert(parent.pid().as_u32(), parent.name().to_string_lossy().to_string());
        }
        Ok(build_process_details(process, &pid_to_name, &self.users))
    }

    pub fn collect(&mut self) -> MetricsSnapshot {
        // Refresh all subsystems
        self.sys.refresh_cpu_all();
        self.sys.refresh_memory();
        self.sys
            .refresh_processes_specifics(ProcessesToUpdate::All, true, process_refresh_kind());
        // `true` re-scans the mount list so hot-plugged volumes appear.
        self.disks.refresh(true);
        self.networks.refresh(true);
        self.components.refresh(false);
        if self.users_refreshed_at.elapsed() >= USERS_REFRESH_EVERY {
            self.users.refresh();
            self.users_refreshed_at = Instant::now();
        }
        let now = Instant::now();
        // Seconds covered by the per-refresh I/O counters below.
        let io_dt = self
            .last_collect
            .map(|t| now.duration_since(t).as_secs_f64().max(0.1));
        self.last_collect = Some(now);
        let per_sec = |bytes: u64| io_dt.map(|dt| (bytes as f64 / dt) as u64).unwrap_or(0);

        let now_ms = now_ms();

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
        let mut seen_devices = HashSet::new();
        let mut disks: Vec<DiskInfo> = self.disks.iter()
            .filter(|d| {
                is_user_facing_disk(
                    &d.mount_point().to_string_lossy(),
                    &d.file_system().to_string_lossy(),
                    d.total_space(),
                )
            })
            // Bind mounts and btrfs subvolumes report the same device several
            // times on Unix; keep only the first. Skipped on Windows, where
            // `name` is the volume label and two drives can share one.
            .filter(|d| {
                let name = d.name().to_string_lossy().to_string();
                cfg!(windows) || name.is_empty() || seen_devices.insert((name, d.total_space()))
            })
            .map(|d| {
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
                read_bps: per_sec(d.usage().read_bytes),
                write_bps: per_sec(d.usage().written_bytes),
            }
        }).collect();

        // System volume first so "primary disk" means the same thing everywhere
        // (dashboard card, health checks, tray). Stable sort keeps OS order otherwise.
        disks.sort_by_key(|d| !is_system_mount(&d.mount_point));

        // ── Networks ─────────────────────────────────────────────────────────
        let dt_secs = self
            .prev_net
            .as_ref()
            .map(|(ts, _)| now.duration_since(*ts).as_secs_f64().max(0.1));
        let mut networks_info: Vec<NetInfo> = Vec::new();
        let mut current_net: HashMap<String, (u64, u64)> = HashMap::new();
        for (name, data) in self.networks.iter() {
            let recv = data.total_received();
            let sent = data.total_transmitted();
            current_net.insert(name.clone(), (recv, sent));

            let (recv_bps, sent_bps) = match (&self.prev_net, dt_secs) {
                (Some((_, prev)), Some(dt)) => match prev.get(name) {
                    Some((prev_recv, prev_sent)) => (
                        (recv.saturating_sub(*prev_recv) as f64 / dt) as u64,
                        (sent.saturating_sub(*prev_sent) as f64 / dt) as u64,
                    ),
                    None => (0, 0),
                },
                _ => (0, 0),
            };

            if is_loopback_interface(name) {
                continue;
            }
            networks_info.push(NetInfo {
                name: name.clone(),
                bytes_recv: recv,
                bytes_sent: sent,
                recv_bps,
                sent_bps,
            });
        }
        networks_info.sort_by(|a, b| a.name.cmp(&b.name));
        self.prev_net = Some((now, current_net));

        // ── Processes ────────────────────────────────────────────────────────
        let pid_to_name: HashMap<u32, String> = self.sys.processes().values()
            .map(|p| (p.pid().as_u32(), p.name().to_string_lossy().to_string()))
            .collect();

        let users = &self.users;
        // On Linux sysinfo also lists every userland thread as a "process";
        // those duplicate their parent's CPU/memory, so hide them like `ps`.
        let mut processes: Vec<ProcessInfo> = self.sys.processes().values()
            .filter(|p| p.thread_kind() != Some(sysinfo::ThreadKind::Userland))
            .map(|p| build_process_info(p, &pid_to_name, users, io_dt))
            .collect();
        let process_count = processes.len();
        let processes_truncated = !self.full_process_list;
        if processes_truncated {
            processes = select_top_processes(processes);
        }

        // ── Health / Temperatures ─────────────────────────────────────────────
        let cpu_temp = pick_cpu_temperature(
            self.components.iter().map(|c| (c.label(), c.temperature())),
        );

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
            batteries: self.battery.collect(),
            disks,
            networks: networks_info,
            processes,
            process_count,
            processes_truncated,
            health: HealthInfo {
                cpu_temp,
                gpu_temp,
                overall,
            },
        }
    }
}

// ─── Disk scanner ────────────────────────────────────────────────────────────

/// Upper bounds that keep a scan of a huge volume responsive. When either is
/// hit the result is flagged `truncated` and sizes become lower bounds.
const SCAN_MAX_ENTRIES: usize = 2_000_000;
const SCAN_MAX_DURATION: Duration = Duration::from_secs(20);

struct ScanBudget {
    entries: usize,
    started: Instant,
    exhausted: bool,
}

impl ScanBudget {
    fn new() -> Self {
        Self { entries: 0, started: Instant::now(), exhausted: false }
    }

    fn tick(&mut self) -> bool {
        if self.exhausted {
            return false;
        }
        self.entries += 1;
        // Checking the clock every entry is wasteful; every 4096 is plenty.
        if self.entries >= SCAN_MAX_ENTRIES
            || (self.entries.is_multiple_of(4096) && self.started.elapsed() >= SCAN_MAX_DURATION)
        {
            self.exhausted = true;
        }
        !self.exhausted
    }
}

/// Size on disk of a directory tree. Symlinks are never followed and the scan
/// stays on the starting device (Unix) so network mounts, `/proc`, and
/// bind-mounted volumes don't get double-counted or hang the scan.
fn dir_size(path: &Path, root_dev: Option<u64>, budget: &mut ScanBudget) -> u64 {
    // Iterative to avoid stack overflows on pathologically deep trees.
    let mut total = 0u64;
    let mut stack = vec![path.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(read_dir) = fs::read_dir(&dir) else { continue };
        for entry in read_dir.flatten() {
            if !budget.tick() {
                return total;
            }
            // DirEntry::metadata does not follow symlinks and is free on Windows.
            let Ok(meta) = entry.metadata() else { continue };
            if meta.is_file() {
                total = total.saturating_add(meta.len());
            } else if meta.is_dir() && same_device(&meta, root_dev) {
                stack.push(entry.path());
            }
        }
    }
    total
}

#[cfg(unix)]
fn device_id(meta: &fs::Metadata) -> Option<u64> {
    use std::os::unix::fs::MetadataExt;
    Some(meta.dev())
}

#[cfg(not(unix))]
fn device_id(_meta: &fs::Metadata) -> Option<u64> {
    None
}

fn same_device(meta: &fs::Metadata, root_dev: Option<u64>) -> bool {
    match (root_dev, device_id(meta)) {
        (Some(root), Some(dev)) => root == dev,
        _ => true,
    }
}

/// Split a path into clickable crumbs using the platform's own path parser, so
/// `C:\Users\me`, `\\server\share\dir`, and `/home/me` all work.
pub fn path_breadcrumbs(path: &Path) -> Vec<PathCrumb> {
    let mut crumbs = Vec::new();
    let mut acc = PathBuf::new();
    for component in path.components() {
        acc.push(component.as_os_str());
        let name = match component {
            std::path::Component::Prefix(p) => p.as_os_str().to_string_lossy().to_string(),
            std::path::Component::RootDir => {
                // On Windows the RootDir follows a drive prefix; fold it into
                // that crumb instead of showing a lone separator.
                if let Some(last) = crumbs.last_mut() {
                    let last: &mut PathCrumb = last;
                    last.path = acc.to_string_lossy().to_string();
                    continue;
                }
                std::path::MAIN_SEPARATOR.to_string()
            }
            std::path::Component::CurDir | std::path::Component::ParentDir => continue,
            std::path::Component::Normal(n) => n.to_string_lossy().to_string(),
        };
        crumbs.push(PathCrumb { name, path: acc.to_string_lossy().to_string() });
    }
    crumbs
}

pub fn scan_directory_usage(root_path: &str) -> Result<DiskScanResult, String> {
    let root = PathBuf::from(root_path);
    let root_meta = fs::metadata(&root).map_err(|e| format!("Cannot open {root_path}: {e}"))?;
    if !root_meta.is_dir() {
        return Err(format!("{root_path} is not a directory"));
    }
    let root_dev = device_id(&root_meta);
    let read_dir = fs::read_dir(&root).map_err(|e| format!("Cannot read {root_path}: {e}"))?;

    let mut budget = ScanBudget::new();
    let mut children = Vec::new();
    let mut total_bytes = 0u64;

    for entry in read_dir.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        let Ok(meta) = entry.metadata() else { continue };
        let is_dir = meta.is_dir();
        let bytes = if meta.is_file() {
            meta.len()
        } else if is_dir && same_device(&meta, root_dev) && !budget.exhausted {
            dir_size(&path, root_dev, &mut budget)
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

    for child in &mut children {
        child.usage_pct_of_parent = if total_bytes > 0 {
            (child.bytes as f32 / total_bytes as f32) * 100.0
        } else {
            0.0
        };
    }

    children.sort_by(|a, b| b.bytes.cmp(&a.bytes));
    children.truncate(40);

    Ok(DiskScanResult {
        root_path: root.to_string_lossy().to_string(),
        total_bytes,
        scanned_entries: budget.entries,
        children,
        truncated: budget.exhausted,
        breadcrumbs: path_breadcrumbs(&root),
    })
}

// ─── Platform filters ────────────────────────────────────────────────────────

/// Loopback adapters across platforms: `lo` (Linux), `lo0` (macOS/BSD),
/// "Loopback Pseudo-Interface 1" (Windows).
pub fn is_loopback_interface(name: &str) -> bool {
    let lower = name.to_lowercase();
    lower == "lo" || lower.starts_with("lo0") || lower.starts_with("lo:") || lower.contains("loopback")
}

/// Hide pseudo filesystems and OS-internal volumes that confuse the disk view
/// (and made "the first disk" meaningless for the menubar).
pub fn is_user_facing_disk(mount_point: &str, fs_type: &str, total_bytes: u64) -> bool {
    if total_bytes == 0 {
        return false;
    }
    let fs = fs_type.to_lowercase();
    const PSEUDO_FS: &[&str] = &[
        "tmpfs", "devtmpfs", "devfs", "overlay", "squashfs", "proc", "sysfs", "cgroup",
        "cgroup2", "autofs", "ramfs", "efivarfs", "nsfs", "tracefs", "debugfs", "fusectl",
        "configfs", "securityfs", "pstore", "bpf", "mqueue", "hugetlbfs", "nullfs", "fuse.portal",
        "fuse.gvfsd-fuse", "fuse.snapfuse",
    ];
    if PSEUDO_FS.contains(&fs.as_str()) {
        return false;
    }
    let mp = mount_point;
    // Linux snaps / container runtimes / boot firmware partitions
    if mp.starts_with("/snap/")
        || mp.starts_with("/var/lib/docker")
        || mp.starts_with("/var/lib/snapd")
        || mp.starts_with("/run/")
        || mp == "/boot/efi"
        || mp == "/efi"
    {
        return false;
    }
    // macOS APFS system volumes that share the container with "/"
    if mp.starts_with("/System/Volumes/") && mp != "/System/Volumes/Data" {
        return false;
    }
    if mp.starts_with("/private/var/vm") || mp.starts_with("/Library/Developer/CoreSimulator") {
        return false;
    }
    true
}

/// The volume the OS runs from: `/` on Unix, `%SystemDrive%\` on Windows.
pub fn is_system_mount(mount_point: &str) -> bool {
    if cfg!(windows) {
        let drive = std::env::var("SystemDrive").unwrap_or_else(|_| "C:".to_string());
        mount_point.trim_end_matches(['\\', '/']).eq_ignore_ascii_case(&drive)
    } else {
        mount_point == "/"
    }
}

/// Choose the most representative CPU temperature from sensor labels exposed
/// by sysinfo. Labels differ wildly: `coretemp Package id 0` (Intel/Linux),
/// `k10temp Tctl` (AMD/Linux), `cpu_thermal` (ARM SBCs), `PMU tdie*` / `CPU die`
/// (macOS), ACPI thermal zones on Windows. Package/die readings win over
/// per-core ones; otherwise the hottest matching sensor is used.
pub fn pick_cpu_temperature<'a, I>(sensors: I) -> Option<f32>
where
    I: IntoIterator<Item = (&'a str, Option<f32>)>,
{
    let mut best: Option<(u8, f32)> = None;
    for (label, temp) in sensors {
        let Some(t) = temp.filter(|t| t.is_finite() && *t > 0.0 && *t < 150.0) else { continue };
        let l = label.to_lowercase();
        let rank = if l.contains("package") || l.contains("tctl") || l.contains("tdie") || l.contains("cpu die") {
            3
        } else if l.contains("cpu") || l.contains("k10temp") || l.contains("zenpower") || l.contains("coretemp") || l.contains("soc_thermal") {
            2
        } else if l.contains("core") || l.contains("thermalzone") || l.contains("acpitz") {
            1
        } else {
            continue;
        };
        best = match best {
            Some((r, bt)) if r > rank || (r == rank && bt >= t) => Some((r, bt)),
            _ => Some((rank, t)),
        };
    }
    best.map(|(_, t)| t)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    /// A small, deterministic snapshot for logic tests elsewhere.
    pub(crate) fn fake_snapshot() -> MetricsSnapshot {
        let proc = |pid: u32, name: &str, cpu: f32, mem: u64| ProcessInfo {
            pid,
            name: name.into(),
            cpu_pct: cpu,
            mem_bytes: mem,
            disk_read_bps: 0,
            disk_write_bps: 0,
            status: "Run".into(),
            parent_pid: None,
            parent_name: None,
            exe_path: None,
            user: None,
            app_name: name.into(),
            group_key: format!("name:{name}"),
            process_kind: "background-process".into(),
            friendly_name: None,
            run_time_secs: 10,
        };
        MetricsSnapshot {
            timestamp: 1_000,
            cpu: CpuInfo { usage_pct: 10.0, core_usage: vec![10.0; 4], core_count: 4, model: "Test CPU".into(), load_avg: [0.0; 3], frequency_mhz: 3000 },
            memory: MemInfo { total_bytes: 16_000_000_000, used_bytes: 4_000_000_000, available_bytes: 12_000_000_000, usage_pct: 25.0, swap_total_bytes: 0, swap_used_bytes: 0 },
            gpu: None,
            batteries: vec![],
            disks: vec![DiskInfo {
                name: "disk0".into(), mount_point: "/".into(), fs_type: "ext4".into(),
                total_bytes: 100_000_000_000, used_bytes: 50_000_000_000, available_bytes: 50_000_000_000,
                usage_pct: 50.0, is_removable: false, read_bps: 0, write_bps: 0,
            }],
            networks: vec![],
            processes: vec![proc(1, "idle", 0.5, 10_000_000), proc(2, "busy", 88.0, 500_000_000)],
            process_count: 2,
            processes_truncated: false,
            health: HealthInfo { cpu_temp: None, gpu_temp: None, overall: "good".into() },
        }
    }

    #[test]
    fn loopback_detection_is_cross_platform() {
        assert!(is_loopback_interface("lo"));
        assert!(is_loopback_interface("lo0"));
        assert!(is_loopback_interface("Loopback Pseudo-Interface 1"));
        assert!(!is_loopback_interface("eth0"));
        assert!(!is_loopback_interface("wlan0"));
        assert!(!is_loopback_interface("en0"));
        assert!(!is_loopback_interface("Ethernet"));
        // Previously `starts_with("lo")` hid these:
        assert!(!is_loopback_interface("lowpan0"));
        assert!(!is_loopback_interface("Local Area Connection"));
    }

    #[test]
    fn disk_filter_hides_pseudo_and_system_volumes() {
        assert!(is_user_facing_disk("/", "ext4", 100));
        assert!(is_user_facing_disk("C:\\", "NTFS", 100));
        assert!(is_user_facing_disk("/Volumes/USB", "exfat", 100));
        assert!(is_user_facing_disk("/System/Volumes/Data", "apfs", 100));
        assert!(!is_user_facing_disk("/System/Volumes/VM", "apfs", 100));
        assert!(!is_user_facing_disk("/snap/core/123", "squashfs", 100));
        assert!(!is_user_facing_disk("/dev/shm", "tmpfs", 100));
        assert!(!is_user_facing_disk("/boot/efi", "vfat", 100));
        assert!(!is_user_facing_disk("/mnt/empty", "ext4", 0));
    }

    #[test]
    fn cpu_temperature_prefers_package_sensor() {
        let sensors = vec![
            ("coretemp Core 0", Some(55.0)),
            ("coretemp Package id 0", Some(60.0)),
            ("coretemp Core 1", Some(70.0)),
            ("nvme Composite", Some(80.0)),
        ];
        assert_eq!(pick_cpu_temperature(sensors), Some(60.0));
    }

    #[test]
    fn cpu_temperature_handles_amd_and_bad_values() {
        let sensors = vec![("k10temp Tctl", Some(65.5)), ("amdgpu edge", Some(50.0))];
        assert_eq!(pick_cpu_temperature(sensors), Some(65.5));
        let sensors = vec![("cpu_thermal temp1", Some(f32::NAN)), ("acpitz temp1", Some(41.0))];
        assert_eq!(pick_cpu_temperature(sensors), Some(41.0));
        assert_eq!(pick_cpu_temperature(vec![("nvme Composite", Some(40.0))]), None);
    }

    #[test]
    fn breadcrumbs_cover_every_ancestor() {
        let dir = std::env::temp_dir().join("resourcescope-crumbs").join("a");
        let crumbs = path_breadcrumbs(&dir);
        assert_eq!(crumbs.last().unwrap().name, "a");
        assert_eq!(PathBuf::from(&crumbs.last().unwrap().path), dir);
        // Every crumb's path is a prefix of the next one.
        for pair in crumbs.windows(2) {
            assert!(Path::new(&pair[1].path).starts_with(&pair[0].path));
        }
    }

    #[test]
    fn scan_directory_counts_nested_files_beyond_three_levels() {
        let root = std::env::temp_dir().join(format!("resourcescope-scan-{}", std::process::id()));
        let deep = root.join("top").join("b").join("c").join("d").join("e");
        fs::create_dir_all(&deep).unwrap();
        fs::write(deep.join("file.bin"), vec![0u8; 4096]).unwrap();
        fs::write(root.join("small.txt"), b"hi").unwrap();

        let result = scan_directory_usage(root.to_str().unwrap()).unwrap();
        fs::remove_dir_all(&root).ok();

        assert_eq!(result.total_bytes, 4098);
        assert!(!result.truncated);
        assert_eq!(result.children[0].name, "top");
        assert_eq!(result.children[0].bytes, 4096);
    }

    /// Exercises the real collectors on whatever OS CI runs on.
    #[test]
    fn collect_smoke_test() {
        let mut collector = MetricsCollector::new();
        let first = collector.collect();
        std::thread::sleep(Duration::from_millis(250));
        let snap = collector.collect();
        assert!(snap.timestamp >= first.timestamp);
        assert!(snap.cpu.core_count > 0);
        assert_eq!(snap.cpu.core_usage.len(), snap.cpu.core_count);
        assert!(snap.memory.total_bytes > 0);
        assert!(!snap.processes.is_empty());
        assert!(snap.networks.iter().all(|n| !is_loopback_interface(&n.name)));
        // Our own process should have its user and command line resolved.
        let me = std::process::id();
        if let Some(p) = snap.processes.iter().find(|p| p.pid == me) {
            assert!(p.user.as_deref().is_some_and(|u| !u.is_empty()));
        }
        serde_json::to_string(&snap).expect("snapshot serializes");
    }

    #[test]
    fn scan_directory_reports_missing_path() {
        assert!(scan_directory_usage("/definitely/not/a/real/path/resourcescope").is_err());
    }
}
