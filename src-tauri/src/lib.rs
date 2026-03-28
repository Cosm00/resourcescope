mod metrics;

use metrics::{MetricsCollector, MetricsSnapshot};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

// ─── Global collector (shared across commands) ────────────────────────────────
type CollectorState = Arc<Mutex<MetricsCollector>>;

// ─── Tauri Commands ───────────────────────────────────────────────────────────

/// One-shot snapshot — used for initial load before event loop kicks in
#[tauri::command]
fn get_metrics(state: tauri::State<CollectorState>) -> MetricsSnapshot {
    let mut collector = state.lock().unwrap();
    collector.collect()
}

// ─── Background event loop ────────────────────────────────────────────────────

/// Spawn background task that emits "metrics_update" every `interval_ms`
fn start_metrics_loop(app: AppHandle, state: CollectorState, interval_ms: u64) {
    tokio::spawn(async move {
        let mut ticker = tokio::time::interval(
            std::time::Duration::from_millis(interval_ms),
        );
        // Let the first tick fire immediately (tokio default) but consume it
        // to avoid a burst on startup
        ticker.tick().await;

        loop {
            ticker.tick().await;
            let snapshot = {
                let mut col = state.lock().unwrap();
                col.collect()
            };
            if let Err(e) = app.emit("metrics_update", &snapshot) {
                eprintln!("emit error: {e}");
            }
        }
    });
}

// ─── App entry ────────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let collector = Arc::new(Mutex::new(MetricsCollector::new()));
    let collector_for_loop = Arc::clone(&collector);

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(collector)
        .invoke_handler(tauri::generate_handler![get_metrics])
        .setup(|app| {
            // Start background metrics emission at 1500ms (fast tick)
            let handle = app.handle().clone();
            start_metrics_loop(handle, collector_for_loop, 1500);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
