//! Process table: per-process metrics, app grouping, and heuristics that
//! explain what a process is. Kept separate from the system collectors so the
//! heuristics can grow (and be tested) without touching the sampling code.

use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::path::Path;
use sysinfo::{Process, Users};

/// One row of the process table. Deliberately lean: it is sent for every
/// process on every tick while the Processes tab is open. Heavier fields
/// (command line, cwd, explanation) come from [`ProcessDetails`] on demand.
#[derive(Serialize, Clone, Debug)]
pub struct ProcessInfo {
    pub pid: u32,
    pub name: String,
    pub cpu_pct: f32,
    pub mem_bytes: u64,
    pub disk_read_bps: u64,
    pub disk_write_bps: u64,
    pub status: String,
    pub parent_pid: Option<u32>,
    pub parent_name: Option<String>,
    pub exe_path: Option<String>,
    pub user: Option<String>,
    /// Display name of the app this process belongs to (its group).
    pub app_name: String,
    /// Stable key for grouping helper processes under one app.
    pub group_key: String,
    pub process_kind: String,
    pub friendly_name: Option<String>,
    pub run_time_secs: u64,
}

#[derive(Serialize, Clone, Debug)]
pub struct ProcessDetails {
    #[serde(flatten)]
    pub info: ProcessInfo,
    pub cmd: Vec<String>,
    pub cwd: Option<String>,
    pub explanation: Option<String>,
    pub bundle_hint: Option<String>,
    pub start_time: u64,
    pub virtual_mem_bytes: u64,
    pub disk_total_read_bytes: u64,
    pub disk_total_written_bytes: u64,
}

pub fn build_process_info(
    p: &Process,
    pid_to_name: &HashMap<u32, String>,
    users: &Users,
    io_dt_secs: Option<f64>,
) -> ProcessInfo {
    let pid = p.pid().as_u32();
    let name = p.name().to_string_lossy().to_string();
    let parent_pid = p.parent().map(|pp| pp.as_u32());
    let parent_name = parent_pid.and_then(|pp| pid_to_name.get(&pp).cloned());
    let exe_path = p.exe().map(|x| x.to_string_lossy().to_string()).filter(|s| !s.is_empty());
    let user = p.user_id().map(|uid| {
        users
            .get_user_by_id(uid)
            .map(|u| u.name().to_string())
            .unwrap_or_else(|| uid.to_string())
    });
    let (group_key, app_name) = process_group(&name, exe_path.as_deref());
    let process_kind = if p.thread_kind() == Some(sysinfo::ThreadKind::Kernel) {
        "system-service".to_string()
    } else {
        infer_process_kind(&name, exe_path.as_deref(), parent_name.as_deref())
    };
    let friendly_name = friendly_name_for_process(&name);
    let usage = p.disk_usage();
    let rate = |bytes: u64| io_dt_secs.map(|dt| (bytes as f64 / dt) as u64).unwrap_or(0);

    ProcessInfo {
        pid,
        name,
        cpu_pct: p.cpu_usage(),
        mem_bytes: p.memory(),
        disk_read_bps: rate(usage.read_bytes),
        disk_write_bps: rate(usage.written_bytes),
        status: format!("{:?}", p.status()),
        parent_pid,
        parent_name,
        exe_path,
        user,
        app_name,
        group_key,
        process_kind,
        friendly_name,
        run_time_secs: p.run_time(),
    }
}

pub fn build_process_details(
    p: &Process,
    pid_to_name: &HashMap<u32, String>,
    users: &Users,
) -> ProcessDetails {
    // Rates are meaningless for a one-off lookup; the table already has them.
    let info = build_process_info(p, pid_to_name, users, None);
    let cmd: Vec<String> = p.cmd().iter().map(|c| c.to_string_lossy().to_string()).collect();
    let cwd = p.cwd().map(|x| x.to_string_lossy().to_string()).filter(|s| !s.is_empty());
    let explanation = explanation_for_process(&info.name, info.parent_name.as_deref(), info.exe_path.as_deref());
    let bundle_hint = infer_bundle_hint(info.exe_path.as_deref(), &cmd);
    let usage = p.disk_usage();
    ProcessDetails {
        cmd,
        cwd,
        explanation,
        bundle_hint,
        start_time: p.start_time(),
        virtual_mem_bytes: p.virtual_memory(),
        disk_total_read_bytes: usage.total_read_bytes,
        disk_total_written_bytes: usage.total_written_bytes,
        info,
    }
}

/// The subset sent when the full table isn't on screen: the busiest
/// processes by CPU, by memory, and by disk I/O, so every "top N" view (CPU,
/// Memory, overview) has what it needs. Returned sorted by CPU, then memory.
pub fn select_top_processes(all: Vec<ProcessInfo>) -> Vec<ProcessInfo> {
    const BY_CPU: usize = 50;
    const BY_MEM: usize = 50;
    const BY_IO: usize = 20;

    let mut keep: HashSet<u32> = HashSet::new();
    let mut idx: Vec<usize> = (0..all.len()).collect();

    idx.sort_by(|&a, &b| all[b].cpu_pct.total_cmp(&all[a].cpu_pct));
    keep.extend(idx.iter().take(BY_CPU).map(|&i| all[i].pid));
    idx.sort_by(|&a, &b| all[b].mem_bytes.cmp(&all[a].mem_bytes));
    keep.extend(idx.iter().take(BY_MEM).map(|&i| all[i].pid));
    idx.sort_by_key(|&i| std::cmp::Reverse(all[i].disk_read_bps + all[i].disk_write_bps));
    keep.extend(
        idx.iter()
            .take(BY_IO)
            .filter(|&&i| all[i].disk_read_bps + all[i].disk_write_bps > 0)
            .map(|&i| all[i].pid),
    );

    let mut out: Vec<ProcessInfo> = all.into_iter().filter(|p| keep.contains(&p.pid)).collect();
    out.sort_by(|a, b| {
        b.cpu_pct
            .total_cmp(&a.cpu_pct)
            .then_with(|| b.mem_bytes.cmp(&a.mem_bytes))
    });
    out
}

/// Group a process under the app it belongs to, similar to Task Manager's
/// "Apps" view: macOS bundles (outermost `.app`), otherwise the executable
/// path (Chrome/Electron/Firefox children share their main binary), otherwise
/// the name with any per-instance suffix removed (`kworker/0:1` → `kworker`).
/// Returns `(key, display name)`.
pub fn process_group(name: &str, exe_path: Option<&str>) -> (String, String) {
    if let Some(exe) = exe_path {
        if let Some(bundle) = app_name_from_path(exe) {
            return (format!("bundle:{}", bundle.to_lowercase()), bundle);
        }
        let file = exe.rsplit(['/', '\\']).next().unwrap_or(exe);
        let stem = strip_exe_suffix(file);
        let display = friendly_name_for_process(file)
            .or_else(|| friendly_name_for_process(stem))
            .unwrap_or_else(|| stem.to_string());
        return (format!("exe:{}", exe.to_lowercase()), display);
    }
    let base = name.split(['/', ':']).next().filter(|s| !s.is_empty()).unwrap_or(name);
    let base = strip_exe_suffix(base);
    let display = friendly_name_for_process(name).unwrap_or_else(|| base.to_string());
    (format!("name:{}", base.to_lowercase()), display)
}

fn strip_exe_suffix(file: &str) -> &str {
    if file.len() > 4 && file[file.len() - 4..].eq_ignore_ascii_case(".exe") {
        &file[..file.len() - 4]
    } else {
        file
    }
}

fn infer_process_kind(name: &str, exe_path: Option<&str>, parent_name: Option<&str>) -> String {
    let lower = name.to_lowercase();
    // Normalise Windows separators so one set of rules covers every platform.
    let exe = exe_path.unwrap_or("").to_lowercase().replace('\\', "/");
    let parent = parent_name.unwrap_or("").to_lowercase();
    let stem = lower.strip_suffix(".exe").unwrap_or(&lower);

    let system_dirs = [
        // macOS
        "/system/",
        "/usr/libexec/",
        "/usr/sbin/",
        // Linux
        "/usr/lib/systemd/",
        "/lib/systemd/",
        "/sbin/",
        // Windows
        "/windows/system32/",
        "/windows/syswow64/",
        "/windows/systemapps/",
    ];
    let windows_services = ["svchost", "services", "lsass", "csrss", "wininit", "winlogon", "smss", "dwm", "spoolsv"];
    let is_unix_daemon = !cfg!(windows) && lower.len() > 2 && lower.ends_with('d');

    if system_dirs.iter().any(|d| exe.contains(d))
        || windows_services.contains(&stem)
        || is_unix_daemon
        || exe.is_empty() && (lower.starts_with("kworker") || lower.starts_with("ksoftirqd"))
    {
        "system-service".to_string()
    } else if exe.contains(".app/") {
        "app-process".to_string()
    } else if parent.contains("helper") || lower.contains("helper") {
        "helper-process".to_string()
    } else if exe.starts_with("/opt/homebrew")
        || exe.starts_with("/usr/local")
        || exe.starts_with("/usr/bin/")
        || exe.starts_with("/bin/")
        || exe.contains("/.cargo/bin/")
        || exe.contains("/scoop/")
    {
        "cli-tool".to_string()
    } else if exe.contains("/program files") || exe.contains("/appdata/local/programs/") || exe.starts_with("/opt/") || exe.contains("/flatpak/") || exe.starts_with("/snap/") {
        "app-process".to_string()
    } else {
        "background-process".to_string()
    }
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
        // Windows
        "svchost.exe" => Some("Windows service host".to_string()),
        "dwm.exe" => Some("Desktop Window Manager".to_string()),
        "msmpeng.exe" => Some("Microsoft Defender antivirus".to_string()),
        "searchindexer.exe" => Some("Windows Search indexer".to_string()),
        "system" => Some("Windows kernel & drivers".to_string()),
        "memory compression" => Some("Windows memory compression".to_string()),
        "tiworker.exe" => Some("Windows Update installer worker".to_string()),
        // Linux
        "systemd" => Some("systemd init / service manager".to_string()),
        "xorg" => Some("X11 display server".to_string()),
        "gnome-shell" => Some("GNOME desktop shell".to_string()),
        "kwin_wayland" | "kwin_x11" => Some("KDE window compositor".to_string()),
        "pipewire" => Some("PipeWire audio/video server".to_string()),
        "tracker-miner-fs-3" => Some("GNOME file indexer".to_string()),
        "baloo_file" => Some("KDE file indexer".to_string()),
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
        "svchost.exe" => "Hosts one or more Windows services. Check the command line (-k group / -s service) to see which service is busy.",
        "msmpeng.exe" => "Microsoft Defender's scanning engine. Spikes during scheduled scans, updates, or when many files are written.",
        "searchindexer.exe" | "tracker-miner-fs-3" | "baloo_file" => "Desktop search indexing. High usage usually means new or changed files are being indexed.",
        "dwm.exe" | "xorg" | "gnome-shell" | "kwin_wayland" | "kwin_x11" => "Composites the desktop. High usage often comes from many windows, high-refresh displays, animations, or screen capture.",
        "tiworker.exe" => "Installs Windows updates and optional features. Usually settles once updates finish.",
        "system" if cfg!(windows) => "The Windows kernel and drivers. Sustained high CPU can point at a misbehaving driver or heavy disk/network I/O.",
        _ if exe.contains(".app/") => "This process belongs to a desktop app bundle. Open details to inspect the bundle/app path and parent process.",
        _ if !cfg!(windows) && lower.ends_with('d') => "This looks like a background daemon/service. Check the parent process and executable path for attribution.",
        _ if !parent.is_empty() => return Some(format!("Likely related to parent process: {parent}.")),
        _ => return None,
    };
    Some(msg.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn process_kind_understands_windows_paths() {
        assert_eq!(
            infer_process_kind("svchost.exe", Some("C:\\Windows\\System32\\svchost.exe"), None),
            "system-service"
        );
        assert_eq!(
            infer_process_kind("Code.exe", Some("C:\\Program Files\\Microsoft VS Code\\Code.exe"), None),
            "app-process"
        );
        assert_eq!(infer_process_kind("sshd", Some("/usr/sbin/sshd"), None), "system-service");
        assert_eq!(
            infer_process_kind("Safari", Some("/Applications/Safari.app/Contents/MacOS/Safari"), None),
            "app-process"
        );
    }

    #[test]
    fn groups_helpers_under_their_app() {
        let (k1, n1) = process_group(
            "Google Chrome Helper (Renderer)",
            Some("/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Helpers/Google Chrome Helper (Renderer).app/Contents/MacOS/Google Chrome Helper (Renderer)"),
        );
        let (k2, _) = process_group("Google Chrome", Some("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"));
        assert_eq!(k1, k2);
        assert_eq!(n1, "Google Chrome");

        let (w1, wn) = process_group("chrome.exe", Some("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"));
        let (w2, _) = process_group("chrome.exe", Some("C:\\Program Files\\Google\\Chrome\\Application\\CHROME.EXE"));
        assert_eq!(w1, w2);
        assert_eq!(wn, "chrome");

        let (s, sn) = process_group("svchost.exe", Some("C:\\Windows\\System32\\svchost.exe"));
        assert!(s.starts_with("exe:"));
        assert_eq!(sn, "Windows service host");

        let (a, an) = process_group("kworker/0:1", None);
        let (b, _) = process_group("kworker/u8:2", None);
        assert_eq!(a, b);
        assert_eq!(an, "kworker");
    }

    fn fake(pid: u32, cpu: f32, mem: u64, io: u64) -> ProcessInfo {
        ProcessInfo {
            pid,
            name: format!("p{pid}"),
            cpu_pct: cpu,
            mem_bytes: mem,
            disk_read_bps: io,
            disk_write_bps: 0,
            status: "Run".into(),
            parent_pid: None,
            parent_name: None,
            exe_path: None,
            user: None,
            app_name: String::new(),
            group_key: String::new(),
            process_kind: String::new(),
            friendly_name: None,
            run_time_secs: 0,
        }
    }

    #[test]
    fn top_selection_keeps_memory_and_io_heavy_idle_processes() {
        let mut all: Vec<ProcessInfo> = (0..500).map(|i| fake(i, i as f32 / 10.0, 1_000, 0)).collect();
        all.push(fake(9001, 0.0, u64::MAX / 2, 0)); // idle but huge
        all.push(fake(9002, 0.0, 10, 50_000_000)); // idle CPU, heavy disk
        let top = select_top_processes(all);
        assert!(top.iter().any(|p| p.pid == 9001));
        assert!(top.iter().any(|p| p.pid == 9002));
        assert!(top.iter().any(|p| p.pid == 499));
        assert!(top.len() <= 120);
        assert!(top.windows(2).all(|w| w[0].cpu_pct >= w[1].cpu_pct));
    }
}
