mod gpu;
mod metrics;

use metrics::{scan_directory_usage, DiskScanResult, MetricsCollector, MetricsSnapshot};
use std::sync::{atomic::{AtomicU64, Ordering}, Arc, Mutex};
use tauri::{
    menu::MenuBuilder,
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, WindowEvent,
};

#[cfg(target_os = "macos")]
use tauri::ActivationPolicy;

// ─── Global collector (shared across commands) ────────────────────────────────
type CollectorState = Arc<Mutex<MetricsCollector>>;
type IntervalState = Arc<AtomicU64>;
type MenubarStatsState = Arc<std::sync::atomic::AtomicBool>;
type MenubarModeState = Arc<Mutex<String>>;
struct MenubarIntervalState(Arc<AtomicU64>);

const MAIN_WINDOW_LABEL: &str = "main";
const TRAY_ID: &str = "resourcescope-tray";
const MENU_TOGGLE_WINDOW: &str = "toggle_window";
const MENU_SHOW_WINDOW: &str = "show_window";
const MENU_HIDE_WINDOW: &str = "hide_window";
const MENU_QUIT: &str = "quit";

// ─── Tauri Commands ───────────────────────────────────────────────────────────

/// One-shot snapshot — used for initial load before event loop kicks in
#[tauri::command]
fn get_metrics(state: tauri::State<CollectorState>) -> MetricsSnapshot {
    let mut collector = state.lock().unwrap();
    collector.collect()
}

#[tauri::command]
fn set_refresh_interval(interval_ms: u64, state: tauri::State<IntervalState>) -> Result<(), String> {
    let clamped = interval_ms.clamp(500, 10_000);
    state.store(clamped, Ordering::Relaxed);
    Ok(())
}

#[tauri::command]
fn hide_to_tray(app: AppHandle) -> Result<(), String> {
    hide_main_window(&app).map_err(|e| e.to_string())
}

#[tauri::command]
fn set_show_menubar_stats(show: bool, state: tauri::State<MenubarStatsState>) -> Result<(), String> {
    state.store(show, Ordering::Relaxed);
    Ok(())
}

#[tauri::command]
fn set_menubar_mode(mode: String, state: tauri::State<MenubarModeState>) -> Result<(), String> {
    *state.lock().unwrap() = mode;
    Ok(())
}

#[tauri::command]
fn set_menubar_refresh_interval(interval_ms: u64, state: tauri::State<MenubarIntervalState>) -> Result<(), String> {
    state.0.store(interval_ms.clamp(500, 10_000), Ordering::Relaxed);
    Ok(())
}

#[tauri::command]
fn scan_disk_directory(path: String) -> Result<DiskScanResult, String> {
    Ok(scan_directory_usage(&path))
}

#[tauri::command]
fn terminate_process(pid: u32, force: bool, state: tauri::State<CollectorState>) -> Result<(), String> {
    use sysinfo::{Pid, ProcessesToUpdate};

    let mut collector = state.lock().map_err(|_| "collector lock poisoned".to_string())?;
    collector.system.refresh_processes(ProcessesToUpdate::All, true);

    let proc = collector
        .system
        .process(Pid::from_u32(pid))
        .ok_or_else(|| format!("Process {pid} not found"))?;

    let signal = if force { Signal::Kill } else { Signal::Term };
    match proc.kill_with(signal) {
        Some(true) => Ok(()),
        Some(false) => Err(format!("Failed to terminate process {pid}")),
        None => Err(format!("Terminate action is not supported on this platform for process {pid}")),
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
                let _ = toggle_main_window(&tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

// ─── Background event loop ────────────────────────────────────────────────────

/// Spawn background task that emits "metrics_update" at a dynamic interval.
/// The interval is read from `interval_state` each tick, so changes take effect
/// on the next cycle without restarting the task.
fn start_metrics_loop(app: AppHandle, state: CollectorState, interval_state: IntervalState, menubar_stats_state: MenubarStatsState, menubar_mode_state: MenubarModeState, menubar_interval_state: MenubarIntervalState) {
    tokio::spawn(async move {
        // Consume the first immediate tick to avoid a burst on startup
        let initial_ms = interval_state.load(Ordering::Relaxed);
        tokio::time::sleep(std::time::Duration::from_millis(initial_ms)).await;

        let mut menubar_tick = 0u64;
        loop {
            let snapshot = {
                let mut col = state.lock().unwrap();
                col.collect()
            };
            if let Err(e) = app.emit("metrics_update", &snapshot) {
                eprintln!("emit error: {e}");
            }

            menubar_tick = menubar_tick.saturating_add(initial_ms.max(1));
            let menubar_ms = menubar_interval_state.0.load(Ordering::Relaxed);

            if menubar_stats_state.load(Ordering::Relaxed) && menubar_tick >= menubar_ms {
                menubar_tick = 0;
                if let Some(tray) = app.tray_by_id(TRAY_ID) {
                    let mode = menubar_mode_state.lock().unwrap().clone();
                    let title = match mode.as_str() {
                        "cpu" => format!("CPU {:>3.0}%", snapshot.cpu.usage_pct),
                        "memory" => format!("MEM {:>3.0}%", snapshot.memory.usage_pct),
                        "network" => {
                            let recv: u64 = snapshot.networks.iter().map(|n| n.recv_bps).sum();
                            format!("NET ↓{}", recv / 1000)
                        }
                        "disk" => {
                            let primary = snapshot.disks.first().map(|d| d.usage_pct).unwrap_or(0.0);
                            format!("DSK {:>3.0}%", primary)
                        }
                        _ => format!("CPU {:>3.0}%  MEM {:>3.0}%", snapshot.cpu.usage_pct, snapshot.memory.usage_pct),
                    };
                    let _ = tray.set_title(Some(title));
                    let _ = tray.set_tooltip(Some(format!(
                        "ResourceScope\nCPU: {:.1}%\nMemory: {:.1}%\nProcesses: {}",
                        snapshot.cpu.usage_pct,
                        snapshot.memory.usage_pct,
                        snapshot.processes.len()
                    )));
                }
            }

            let ms = interval_state.load(Ordering::Relaxed);
            tokio::time::sleep(std::time::Duration::from_millis(ms)).await;
        }
    });
}

// ─── App entry ────────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let collector = Arc::new(Mutex::new(MetricsCollector::new()));
    let collector_for_loop = Arc::clone(&collector);

    // Default interval: 1500ms — changeable at runtime via set_refresh_interval
    let interval_state: IntervalState = Arc::new(AtomicU64::new(1500));
    let interval_for_loop = Arc::clone(&interval_state);
    let menubar_stats_state: MenubarStatsState = Arc::new(std::sync::atomic::AtomicBool::new(true));
    let menubar_stats_for_loop = Arc::clone(&menubar_stats_state);
    let menubar_mode_state: MenubarModeState = Arc::new(Mutex::new("cpu_mem".to_string()));
    let menubar_mode_for_loop = Arc::clone(&menubar_mode_state);
    let menubar_interval_state = MenubarIntervalState(Arc::new(AtomicU64::new(1500)));
    let menubar_interval_for_loop = MenubarIntervalState(Arc::clone(&menubar_interval_state.0));

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(collector)
        .manage(interval_state)
        .manage(menubar_stats_state)
        .manage(menubar_mode_state)
        .manage(menubar_interval_state)
        .invoke_handler(tauri::generate_handler![
            get_metrics,
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
                    api.prevent_close();
                    let _ = hide_main_window(&window.app_handle());
                }
            }
        })
        .setup(|app| {
            build_tray(&app.handle())?;
            set_launch_presence(&app.handle(), true);

            // Start background metrics emission (dynamic interval via AtomicU64)
            let handle = app.handle().clone();
            start_metrics_loop(handle, collector_for_loop, interval_for_loop, menubar_stats_for_loop, menubar_mode_for_loop, menubar_interval_for_loop);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
