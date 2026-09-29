//! Automatic updates via tauri-plugin-updater.
//!
//! Runs in the backend so it works while the window is hidden in the tray:
//! checks shortly after launch and then every few hours, downloads new
//! versions in the background (signature-verified by the plugin), and tells
//! the user a restart will finish the update. Installing never happens behind
//! the user's back mid-session: on Windows the installer closes the app, and
//! on every platform the new version only runs after a relaunch.
//!
//! Only active when a signing public key is configured (see
//! docs/auto-updates.md); otherwise the UI falls back to a GitHub release
//! check with a download link.

use serde::Serialize;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_updater::{Update, UpdaterExt};

/// First check a little after launch, so startup stays snappy.
const FIRST_CHECK_DELAY: Duration = Duration::from_secs(30);
/// Tray apps run for weeks; re-check periodically rather than only at launch.
const CHECK_EVERY: Duration = Duration::from_secs(6 * 3600);

#[derive(Serialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum Phase {
    #[default]
    Idle,
    Checking,
    UpToDate,
    /// A newer version exists but hasn't been downloaded (auto-download off).
    Available,
    Downloading,
    /// Downloaded and verified; a restart installs it.
    Ready,
    Installing,
    Error,
}

#[derive(Serialize, Clone, Debug, Default)]
pub struct UpdateStatus {
    pub phase: Phase,
    pub current_version: String,
    pub version: Option<String>,
    pub notes: Option<String>,
    /// 0–100 while downloading, when the server reports a size.
    pub progress: Option<f32>,
    pub error: Option<String>,
}

#[derive(Default)]
struct Inner {
    status: UpdateStatus,
    update: Option<Update>,
    bytes: Option<Vec<u8>>,
}

pub struct UpdateManager {
    inner: Mutex<Inner>,
    auto_check: AtomicBool,
    auto_download: AtomicBool,
    busy: AtomicBool,
}

impl UpdateManager {
    pub fn new(current_version: String) -> Self {
        Self {
            inner: Mutex::new(Inner {
                status: UpdateStatus { current_version, ..Default::default() },
                ..Default::default()
            }),
            auto_check: AtomicBool::new(true),
            auto_download: AtomicBool::new(true),
            busy: AtomicBool::new(false),
        }
    }

    pub fn status(&self) -> UpdateStatus {
        self.lock().status.clone()
    }

    pub fn set_auto(&self, check: bool, download: bool) {
        self.auto_check.store(check, Ordering::Relaxed);
        self.auto_download.store(download, Ordering::Relaxed);
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|p| p.into_inner())
    }

    fn set<R: Runtime>(&self, app: &AppHandle<R>, f: impl FnOnce(&mut UpdateStatus)) {
        let status = {
            let mut inner = self.lock();
            f(&mut inner.status);
            inner.status.clone()
        };
        let _ = app.emit("update_status", &status);
    }
}

/// Check for an update and, if auto-download is on (or `force_download`),
/// fetch it. Safe to call concurrently: overlapping calls are dropped.
pub async fn check<R: Runtime>(app: &AppHandle<R>, force_download: bool) -> UpdateStatus {
    let manager = app.state::<UpdateManager>();
    if manager.busy.swap(true, Ordering::AcqRel) {
        return manager.status();
    }
    let result = check_inner(app, &manager, force_download).await;
    manager.busy.store(false, Ordering::Release);
    if let Err(e) = result {
        manager.set(app, |s| {
            s.phase = Phase::Error;
            s.error = Some(e);
            s.progress = None;
        });
    }
    manager.status()
}

async fn check_inner<R: Runtime>(app: &AppHandle<R>, manager: &UpdateManager, force_download: bool) -> Result<(), String> {
    // Already downloaded: nothing more to do until the user restarts.
    if manager.lock().status.phase == Phase::Ready {
        return Ok(());
    }
    manager.set(app, |s| {
        s.phase = Phase::Checking;
        s.error = None;
    });

    let updater = app.updater().map_err(|e| e.to_string())?;
    let Some(update) = updater.check().await.map_err(|e| e.to_string())? else {
        manager.set(app, |s| {
            s.phase = Phase::UpToDate;
            s.version = None;
            s.notes = None;
        });
        return Ok(());
    };

    let version = update.version.clone();
    let notes = update.body.clone();
    manager.lock().update = Some(update.clone());
    manager.set(app, |s| {
        s.phase = Phase::Available;
        s.version = Some(version.clone());
        s.notes = notes.clone();
    });

    if force_download || manager.auto_download.load(Ordering::Relaxed) {
        download(app, manager, &update).await?;
        notify_ready(app, &version);
    }
    Ok(())
}

async fn download<R: Runtime>(app: &AppHandle<R>, manager: &UpdateManager, update: &Update) -> Result<(), String> {
    manager.set(app, |s| {
        s.phase = Phase::Downloading;
        s.progress = Some(0.0);
    });
    let mut received: u64 = 0;
    let mut last_pct = -1i32;
    let bytes = update
        .download(
            |chunk, total| {
                received += chunk as u64;
                if let Some(total) = total.filter(|t| *t > 0) {
                    let pct = ((received as f64 / total as f64) * 100.0).min(100.0);
                    // Emit at most once per whole percent.
                    if pct as i32 != last_pct {
                        last_pct = pct as i32;
                        manager.set(app, |s| s.progress = Some(pct as f32));
                    }
                }
            },
            || {},
        )
        .await
        .map_err(|e| format!("Download failed: {e}"))?;
    manager.lock().bytes = Some(bytes);
    manager.set(app, |s| {
        s.phase = Phase::Ready;
        s.progress = None;
    });
    Ok(())
}

fn notify_ready<R: Runtime>(app: &AppHandle<R>, version: &str) {
    use tauri_plugin_notification::NotificationExt;
    let _ = app
        .notification()
        .builder()
        .title(format!("ResourceScope {version} is ready"))
        .body("Restart ResourceScope to finish updating.")
        .show();
}

/// Install the downloaded update (downloading first if needed) and relaunch.
/// On Windows the installer closes the app itself and starts the new version.
pub async fn install_and_restart<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let manager = app.state::<UpdateManager>();
    let (update, bytes) = {
        let inner = manager.lock();
        (inner.update.clone(), inner.bytes.clone())
    };
    let update = match update {
        Some(u) => u,
        None => {
            check(app, true).await;
            manager.lock().update.clone().ok_or("No update is available.")?
        }
    };
    let bytes = match bytes {
        Some(b) => b,
        None => {
            download(app, &manager, &update).await?;
            manager.lock().bytes.clone().ok_or("Download failed.")?
        }
    };
    manager.set(app, |s| s.phase = Phase::Installing);
    // Keep the history of the current session before we go away.
    crate::save_history_now(app);
    update.install(bytes).map_err(|e| {
        let msg = format!("Install failed: {e}");
        manager.set(app, |s| {
            s.phase = Phase::Error;
            s.error = Some(msg.clone());
        });
        msg
    })?;
    app.restart();
}

/// Background loop: first check shortly after launch, then every few hours.
pub fn start_loop<R: Runtime>(app: AppHandle<R>) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(FIRST_CHECK_DELAY).await;
        loop {
            let auto = app.state::<UpdateManager>().auto_check.load(Ordering::Relaxed);
            if auto {
                check(&app, false).await;
            }
            tokio::time::sleep(CHECK_EVERY).await;
        }
    });
}
