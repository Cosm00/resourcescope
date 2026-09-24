mod battery;
mod gpu;
mod history;
mod metrics;
mod processes;

use metrics::{is_system_mount, scan_directory_usage, DiskScanResult, MetricsCollector, MetricsSnapshot};
use serde::Serialize;
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Arc, Mutex, MutexGuard,
};
use std::time::{Duration, Instant};
use tauri::{
    menu::MenuBuilder,
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, WindowEvent,
};

#[cfg(target_os = "macos")]
use tauri::ActivationPolicy;

// ─── Global collector (shared across commands) ────────────────────────────────
type CollectorState = Arc<Mutex<MetricsCollector>>;
type HistoryState = Arc<Mutex<history::History>>;
type IntervalState = Arc<AtomicU64>;
type MenubarStatsState = Arc<AtomicBool>;
type MenubarModeState = Arc<Mutex<String>>;
struct MenubarIntervalState(Arc<AtomicU64>);
/// Whether a tray icon was successfully created. Some Linux desktops (e.g.
/// stock GNOME without an AppIndicator extension) have no tray; hiding the
/// window there would make it unrecoverable, so close-to-tray is disabled.
struct TrayAvailable(AtomicBool);

const MAIN_WINDOW_LABEL: &str = "main";
const TRAY_ID: &str = "resourcescope-tray";
const MENU_TOGGLE_WINDOW: &str = "toggle_window";
const MENU_SHOW_WINDOW: &str = "show_window";
const MENU_HIDE_WINDOW: &str = "hide_window";
const MENU_QUIT: &str = "quit";
const HISTORY_SAVE_EVERY: Duration = Duration::from_secs(60);

/// A panic while collecting must not take every later command down with it.
fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

// ─── Tauri Commands ───────────────────────────────────────────────────────────
//
// Commands that touch the filesystem or the collector are `async` and run on
// the blocking pool. Synchronous Tauri commands execute on the main thread,
// so a slow collect (macOS powermetrics) or a disk scan would freeze the UI.

/// One-shot snapshot — used for initial load before event loop kicks in
#[tauri::command]
async fn get_metrics(state: tauri::State<'_, CollectorState>) -> Result<MetricsSnapshot, String> {
    let collector = Arc::clone(state.inner());
    tauri::async_runtime::spawn_blocking(move || lock(&collector).collect())
        .await
        .map_err(|e| e.to_string())
}

/// The Processes tab asks for every process while it is open; other views only
/// need the busiest subset, which keeps each tick's IPC payload small.
#[tauri::command]
fn set_full_process_list(enabled: bool, state: tauri::State<CollectorState>) {
    lock(&state).full_process_list = enabled;
}

#[tauri::command]
async fn get_process_details(
    pid: u32,
    state: tauri::State<'_, CollectorState>,
) -> Result<processes::ProcessDetails, String> {
    let collector = Arc::clone(state.inner());
    tauri::async_runtime::spawn_blocking(move || lock(&collector).process_details(pid))
        .await
        .map_err(|e| e.to_string())?
}

/// Downsampled history for the last `range_secs` (up to 30 days).
#[tauri::command]
fn get_history(range_secs: u64, state: tauri::State<HistoryState>) -> Vec<history::HistoryPoint> {
    lock(&state).query(range_secs.saturating_mul(1000), metrics::now_ms())
}

#[tauri::command]
async fn export_history_csv(range_secs: u64, path: String, state: tauri::State<'_, HistoryState>) -> Result<usize, String> {
    let samples = lock(&state).export_samples(range_secs.saturating_mul(1000), metrics::now_ms());
    let count = samples.len();
    let target = std::path::PathBuf::from(&path);
    tauri::async_runtime::spawn_blocking(move || history::write_csv(&target, &samples))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| format!("Could not write {}: {e}", path))?;
    Ok(count)
}

/// Append each 10-second sample to a daily CSV file in the app's log folder.
/// Returns that folder so the UI can reveal it.
#[tauri::command]
fn set_csv_logging(enabled: bool, state: tauri::State<HistoryState>) -> Option<String> {
    let mut h = lock(&state);
    h.csv_logging = enabled;
    let dir = h.log_dir()?;
    if enabled {
        // Create it now so "Show folder" works before the first row lands.
        let _ = std::fs::create_dir_all(dir);
    }
    Some(dir.to_string_lossy().to_string())
}

#[tauri::command]
fn set_refresh_interval(interval_ms: u64, state: tauri::State<IntervalState>) -> Result<(), String> {
    let clamped = interval_ms.clamp(500, 10_000);
    state.store(clamped, Ordering::Relaxed);
    Ok(())
}

#[tauri::command]
fn hide_to_tray(app: AppHandle) -> Result<(), String> {
    if !tray_available(&app) {
        return Err("No system tray is available on this desktop, so the window can't be hidden to it.".into());
    }
    hide_main_window(&app).map_err(|e| e.to_string())
}

#[derive(Serialize)]
struct PlatformInfo {
    os: &'static str,
    tray_available: bool,
    /// Whether the tray can show text next to the icon (macOS menubar; Linux
    /// AppIndicator labels). Windows tray icons are icon-only.
    tray_title_supported: bool,
}

#[tauri::command]
fn get_platform_info(app: AppHandle) -> PlatformInfo {
    PlatformInfo {
        os: std::env::consts::OS,
        tray_available: tray_available(&app),
        tray_title_supported: cfg!(any(target_os = "macos", target_os = "linux")),
    }
}

#[tauri::command]
fn set_show_menubar_stats(app: AppHandle, show: bool, state: tauri::State<MenubarStatsState>) -> Result<(), String> {
    state.store(show, Ordering::Relaxed);
    if !show {
        // Clear the stale text immediately instead of leaving the last value.
        if let Some(tray) = app.tray_by_id(TRAY_ID) {
            let _ = tray.set_title(None::<&str>);
        }
    }
    Ok(())
}

#[tauri::command]
fn set_menubar_mode(mode: String, state: tauri::State<MenubarModeState>) -> Result<(), String> {
    *lock(&state) = mode;
    Ok(())
}

#[tauri::command]
fn set_menubar_refresh_interval(interval_ms: u64, state: tauri::State<MenubarIntervalState>) -> Result<(), String> {
    state.0.store(interval_ms.clamp(500, 10_000), Ordering::Relaxed);
    Ok(())
}

#[tauri::command]
async fn scan_disk_directory(path: String) -> Result<DiskScanResult, String> {
    tauri::async_runtime::spawn_blocking(move || scan_directory_usage(&path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
fn terminate_process(pid: u32, force: bool, state: tauri::State<CollectorState>) -> Result<(), String> {
    use sysinfo::{Pid, Signal};

    if pid == std::process::id() {
        return Err("Refusing to terminate ResourceScope itself.".into());
    }

    let mut collector = lock(&state);
    let target = Pid::from_u32(pid);
    collector.refresh_process(target);

    let proc = collector
        .sys
        .process(target)
        .ok_or_else(|| format!("Process {pid} not found"))?;

    // Windows has no SIGTERM; sysinfo only supports Kill there, which maps to
    // TerminateProcess. Fall back to it so "End process" works everywhere.
    let signal = if force || cfg!(windows) { Signal::Kill } else { Signal::Term };
    match proc.kill_with(signal) {
        Some(true) => Ok(()),
        Some(false) => Err(format!(
            "Failed to terminate process {pid}. It may belong to another user or require elevated privileges."
        )),
        None => {
            if proc.kill() {
                Ok(())
            } else {
                Err(format!("Failed to terminate process {pid}"))
            }
        }
    }
}

#[tauri::command]
fn show_main_window_command(app: AppHandle) -> Result<(), String> {
    show_main_window(&app).map_err(|e| e.to_string())
}

#[tauri::command]
fn toggle_main_window_command(app: AppHandle) -> Result<(), String> {
    toggle_main_window(&app).map_err(|e| e.to_string())
}

// ─── Window / tray helpers ────────────────────────────────────────────────────

fn tray_available(app: &AppHandle) -> bool {
    app.try_state::<TrayAvailable>()
        .map(|s| s.0.load(Ordering::Relaxed))
        .unwrap_or(false)
}

fn with_main_window<F>(app: &AppHandle, f: F) -> tauri::Result<()>
where
    F: FnOnce(&tauri::WebviewWindow) -> tauri::Result<()>,
{
    let window = app
        .get_webview_window(MAIN_WINDOW_LABEL)
        .ok_or_else(|| tauri::Error::AssetNotFound(MAIN_WINDOW_LABEL.into()))?;
    f(&window)
}

fn set_launch_presence(app: &AppHandle, visible: bool) {
    let _ = with_main_window(app, |window| {
        let _ = window.set_skip_taskbar(!visible);
        Ok(())
    });

    #[cfg(target_os = "macos")]
    {
        let _ = app.set_dock_visibility(visible);
        let _ = app.set_activation_policy(if visible {
            ActivationPolicy::Regular
        } else {
            ActivationPolicy::Accessory
        });
    }
}

fn show_main_window(app: &AppHandle) -> tauri::Result<()> {
    with_main_window(app, |window| {
        let _ = window.unminimize();
        window.show()?;
        window.set_focus()?;
        Ok(())
    })?;

    set_launch_presence(app, true);
    Ok(())
}

fn hide_main_window(app: &AppHandle) -> tauri::Result<()> {
    with_main_window(app, |window| {
        window.hide()?;
        Ok(())
    })?;

    set_launch_presence(app, false);
    Ok(())
}

fn toggle_main_window(app: &AppHandle) -> tauri::Result<()> {
    let is_visible = app
        .get_webview_window(MAIN_WINDOW_LABEL)
        .map(|window| window.is_visible().unwrap_or(false))
        .unwrap_or(false);

    if is_visible {
        hide_main_window(app)
    } else {
        show_main_window(app)
    }
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let menu = MenuBuilder::new(app)
        .text(MENU_TOGGLE_WINDOW, "Show / Hide ResourceScope")
        .text(MENU_SHOW_WINDOW, "Open Dashboard")
        .text(MENU_HIDE_WINDOW, "Hide to Tray")
        .separator()
        .text(MENU_QUIT, "Quit ResourceScope")
        .build()?;

    TrayIconBuilder::with_id(TRAY_ID)
        .menu(&menu)
        .tooltip("ResourceScope")
        .icon(tauri::include_image!("icons/icon.png"))
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            MENU_TOGGLE_WINDOW => {
                let _ = toggle_main_window(app);
            }
            MENU_SHOW_WINDOW => {
                let _ = show_main_window(app);
            }
            MENU_HIDE_WINDOW => {
                let _ = hide_main_window(app);
            }
            MENU_QUIT => {
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let _ = toggle_main_window(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

/// Human-readable byte rate for the tray title, e.g. `1.2M`, `340K`.
fn fmt_rate_short(bps: u64) -> String {
    let b = bps as f64;
    if b >= 1e9 {
        format!("{:.1}G", b / 1e9)
    } else if b >= 1e6 {
        format!("{:.1}M", b / 1e6)
    } else if b >= 1e3 {
        format!("{:.0}K", b / 1e3)
    } else {
        format!("{}B", bps)
    }
}

fn menubar_title(mode: &str, snapshot: &MetricsSnapshot) -> String {
    match mode {
        "cpu" => format!("CPU {:>3.0}%", snapshot.cpu.usage_pct),
        "memory" => format!("MEM {:>3.0}%", snapshot.memory.usage_pct),
        "network" => {
            let recv: u64 = snapshot.networks.iter().map(|n| n.recv_bps).sum();
            let sent: u64 = snapshot.networks.iter().map(|n| n.sent_bps).sum();
            format!("↓{}/s ↑{}/s", fmt_rate_short(recv), fmt_rate_short(sent))
        }
        "disk" => {
            let system = snapshot
                .disks
                .iter()
                .find(|d| is_system_mount(&d.mount_point))
                .or_else(|| snapshot.disks.first());
            format!("DSK {:>3.0}%", system.map(|d| d.usage_pct).unwrap_or(0.0))
        }
        _ => format!("CPU {:>3.0}%  MEM {:>3.0}%", snapshot.cpu.usage_pct, snapshot.memory.usage_pct),
    }
}

// ─── Background event loop ────────────────────────────────────────────────────

/// Spawn a dedicated thread that emits "metrics_update" at a dynamic interval.
/// The interval is read from `interval_state` each tick, so changes take effect
/// on the next cycle without restarting.
///
/// Collection is blocking work (sysinfo syscalls, spawning ioreg/nvidia-smi),
/// so it runs on its own OS thread rather than an async task where it would
/// stall the runtime's worker threads.
fn start_metrics_loop(
    app: AppHandle,
    state: CollectorState,
    history: HistoryState,
    interval_state: IntervalState,
    menubar_stats_state: MenubarStatsState,
    menubar_mode_state: MenubarModeState,
    menubar_interval_state: MenubarIntervalState,
) {
    let spawn = std::thread::Builder::new()
        .name("resourcescope-metrics".into())
        .spawn(move || {
            // Let the initial `get_metrics` invoke land first; sysinfo also needs
            // a gap between refreshes for meaningful CPU percentages.
            std::thread::sleep(Duration::from_millis(interval_state.load(Ordering::Relaxed)));

            let mut last_menubar_update: Option<Instant> = None;
            let mut last_history_save = Instant::now();
            loop {
                let tick_started = Instant::now();
                let snapshot = lock(&state).collect();
                {
                    let mut h = lock(&history);
                    h.ingest(&snapshot);
                    if last_history_save.elapsed() >= HISTORY_SAVE_EVERY {
                        h.save_if_dirty();
                        last_history_save = Instant::now();
                    }
                }
                if let Err(e) = app.emit("metrics_update", &snapshot) {
                    eprintln!("emit error: {e}");
                }

                let menubar_ms = menubar_interval_state.0.load(Ordering::Relaxed);
                let menubar_due = last_menubar_update
                    .map(|t| t.elapsed() + Duration::from_millis(50) >= Duration::from_millis(menubar_ms))
                    .unwrap_or(true);

                if menubar_due {
                    if let Some(tray) = app.tray_by_id(TRAY_ID) {
                        last_menubar_update = Some(Instant::now());
                        if menubar_stats_state.load(Ordering::Relaxed) {
                            let mode = lock(&menubar_mode_state).clone();
                            let _ = tray.set_title(Some(menubar_title(&mode, &snapshot)));
                        }
                        // Tooltips work on every platform (Windows trays are icon-only).
                        let mut tooltip = format!(
                            "ResourceScope\nCPU: {:.1}%\nMemory: {:.1}%",
                            snapshot.cpu.usage_pct, snapshot.memory.usage_pct,
                        );
                        if let Some(b) = snapshot.batteries.first() {
                            tooltip.push_str(&format!("\nBattery: {:.0}% ({})", b.charge_pct, b.state));
                        }
                        let _ = tray.set_tooltip(Some(tooltip));
                    }
                }

                // Keep a steady cadence: subtract the time spent collecting.
                let interval = Duration::from_millis(interval_state.load(Ordering::Relaxed));
                std::thread::sleep(interval.saturating_sub(tick_started.elapsed()).max(Duration::from_millis(100)));
            }
        });
    if let Err(e) = spawn {
        eprintln!("failed to start metrics thread: {e}");
    }
}

// ─── App entry ────────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let collector = Arc::new(Mutex::new(MetricsCollector::new()));
    let collector_for_loop = Arc::clone(&collector);

    // Default interval: 1500ms — changeable at runtime via set_refresh_interval
    let interval_state: IntervalState = Arc::new(AtomicU64::new(1500));
    let interval_for_loop = Arc::clone(&interval_state);
    let menubar_stats_state: MenubarStatsState = Arc::new(AtomicBool::new(true));
    let menubar_stats_for_loop = Arc::clone(&menubar_stats_state);
    let menubar_mode_state: MenubarModeState = Arc::new(Mutex::new("cpu_mem".to_string()));
    let menubar_mode_for_loop = Arc::clone(&menubar_mode_state);
    let menubar_interval_state = MenubarIntervalState(Arc::new(AtomicU64::new(1500)));
    let menubar_interval_for_loop = MenubarIntervalState(Arc::clone(&menubar_interval_state.0));

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(collector)
        .manage(interval_state)
        .manage(menubar_stats_state)
        .manage(menubar_mode_state)
        .manage(menubar_interval_state)
        .manage(TrayAvailable(AtomicBool::new(false)))
        .invoke_handler(tauri::generate_handler![
            get_metrics,
            get_platform_info,
            get_process_details,
            get_history,
            export_history_csv,
            set_csv_logging,
            set_full_process_list,
            set_refresh_interval,
            hide_to_tray,
            set_show_menubar_stats,
            set_menubar_mode,
            set_menubar_refresh_interval,
            scan_disk_directory,
            terminate_process,
            show_main_window_command,
            toggle_main_window_command
        ])
        .on_window_event(|window, event| {
            if window.label() == MAIN_WINDOW_LABEL {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    // Only intercept close when there's a tray to come back from.
                    if tray_available(window.app_handle()) {
                        api.prevent_close();
                        let _ = hide_main_window(window.app_handle());
                    }
                }
            }
        })
        .setup(|app| {
            match build_tray(app.handle()) {
                Ok(()) => app.state::<TrayAvailable>().0.store(true, Ordering::Relaxed),
                Err(e) => eprintln!("system tray unavailable, close will quit instead of hiding: {e}"),
            }
            set_launch_presence(app.handle(), true);

            let history: HistoryState = Arc::new(Mutex::new(history::History::new(
                app.path().app_data_dir().ok().map(|d| d.join("history.bin")),
                app.path().app_log_dir().ok(),
            )));
            app.manage(Arc::clone(&history));

            let handle = app.handle().clone();
            start_metrics_loop(
                handle,
                collector_for_loop,
                history,
                interval_for_loop,
                menubar_stats_for_loop,
                menubar_mode_for_loop,
                menubar_interval_for_loop,
            );
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                // Keep the last minute of history across restarts.
                if let Some(h) = app.try_state::<HistoryState>() {
                    lock(&h).save_if_dirty();
                }
            }
        });
}

#[cfg(test)]
mod tests {
    use super::fmt_rate_short;

    #[test]
    fn rate_formatting() {
        assert_eq!(fmt_rate_short(512), "512B");
        assert_eq!(fmt_rate_short(340_000), "340K");
        assert_eq!(fmt_rate_short(1_250_000), "1.2M");
        assert_eq!(fmt_rate_short(2_000_000_000), "2.0G");
    }
}
