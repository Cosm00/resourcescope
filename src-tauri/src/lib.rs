mod gpu;
mod metrics;

use metrics::{MetricsCollector, MetricsSnapshot};
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
fn start_metrics_loop(app: AppHandle, state: CollectorState, interval_state: IntervalState) {
    tokio::spawn(async move {
        // Consume the first immediate tick to avoid a burst on startup
        let initial_ms = interval_state.load(Ordering::Relaxed);
        tokio::time::sleep(std::time::Duration::from_millis(initial_ms)).await;

        loop {
            let snapshot = {
                let mut col = state.lock().unwrap();
                col.collect()
            };
            if let Err(e) = app.emit("metrics_update", &snapshot) {
                eprintln!("emit error: {e}");
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

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(collector)
        .manage(interval_state)
        .invoke_handler(tauri::generate_handler![
            get_metrics,
            set_refresh_interval,
            hide_to_tray,
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
            start_metrics_loop(handle, collector_for_loop, interval_for_loop);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
