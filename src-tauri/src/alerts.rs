//! Threshold alerts, evaluated in the backend on every tick so they fire
//! even while the window is hidden in the tray (a hidden webview may be
//! throttled or suspended). Pure logic: it takes snapshots and returns the
//! notifications to show, which keeps it unit-testable.

use serde::Deserialize;
use std::collections::HashMap;

use crate::metrics::MetricsSnapshot;

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AlertConfig {
    pub enabled: bool,
    pub cpu_pct: f32,
    pub mem_pct: f32,
    pub disk_pct: f32,
    /// How long CPU/memory/temperature must stay high before alerting.
    pub sustain_secs: u64,
    pub low_battery: bool,
    pub high_temp: bool,
}

impl Default for AlertConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            cpu_pct: 80.0,
            mem_pct: 80.0,
            disk_pct: 85.0,
            sustain_secs: 60,
            low_battery: true,
            high_temp: true,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Notification {
    pub title: String,
    pub body: String,
}

/// Temperature (°C) considered too hot for CPUs/GPUs to sit at for long.
const HOT_C: f32 = 90.0;
/// A metric must drop this far below its threshold before it can re-alert,
/// so a value hovering at the line doesn't spam notifications.
const HYSTERESIS: f32 = 5.0;
/// Minimum time between two alerts of the same kind.
const COOLDOWN_MS: u64 = 15 * 60 * 1000;
/// Disks fill slowly; remind at most this often per volume.
const DISK_COOLDOWN_MS: u64 = 6 * 3600 * 1000;

#[derive(Default, Debug)]
struct Sustained {
    above_since: Option<u64>,
    armed_until_below: bool,
    last_fired: Option<u64>,
}

impl Sustained {
    /// Returns true when the alert should fire now.
    fn update(&mut self, value: Option<f32>, threshold: f32, sustain_ms: u64, now: u64) -> bool {
        let Some(v) = value.filter(|v| v.is_finite()) else {
            self.above_since = None;
            return false;
        };
        if self.armed_until_below {
            if v < threshold - HYSTERESIS {
                self.armed_until_below = false;
            }
            return false;
        }
        if v < threshold {
            self.above_since = None;
            return false;
        }
        let since = *self.above_since.get_or_insert(now);
        let cooled = self.last_fired.map(|t| now.saturating_sub(t) >= COOLDOWN_MS).unwrap_or(true);
        if now.saturating_sub(since) >= sustain_ms && cooled {
            self.last_fired = Some(now);
            self.armed_until_below = true;
            self.above_since = None;
            return true;
        }
        false
    }
}

#[derive(Default)]
pub struct AlertEngine {
    pub config: AlertConfig,
    cpu: Sustained,
    mem: Sustained,
    cpu_temp: Sustained,
    gpu_temp: Sustained,
    disk_last: HashMap<String, u64>,
    disk_armed: HashMap<String, bool>,
    /// Lowest battery level already warned about this discharge (20 or 10).
    battery_warned_at: Option<u8>,
}

impl AlertEngine {
    pub fn evaluate(&mut self, s: &MetricsSnapshot, now: u64) -> Vec<Notification> {
        let mut out = Vec::new();
        if !self.config.enabled {
            return out;
        }
        let c = self.config.clone();
        let sustain = c.sustain_secs.saturating_mul(1000);

        if self.cpu.update(Some(s.cpu.usage_pct), c.cpu_pct, sustain, now) {
            out.push(Notification {
                title: format!("High CPU usage: {:.0}%", s.cpu.usage_pct),
                body: format!(
                    "Above {:.0}% for over {}.{}",
                    c.cpu_pct,
                    human_secs(c.sustain_secs),
                    top_process_hint(s, |p| p.cpu_pct as f64, |p| format!("{:.0}% CPU", p.cpu_pct))
                ),
            });
        }
        if self.mem.update(Some(s.memory.usage_pct), c.mem_pct, sustain, now) {
            out.push(Notification {
                title: format!("High memory usage: {:.0}%", s.memory.usage_pct),
                body: format!(
                    "Above {:.0}% for over {}.{}",
                    c.mem_pct,
                    human_secs(c.sustain_secs),
                    top_process_hint(s, |p| p.mem_bytes as f64, |p| human_bytes(p.mem_bytes))
                ),
            });
        }
        if c.high_temp {
            if self.cpu_temp.update(s.health.cpu_temp, HOT_C, sustain, now) {
                out.push(Notification {
                    title: format!("CPU is running hot: {:.0}°C", s.health.cpu_temp.unwrap_or_default()),
                    body: "Sustained high temperatures can cause throttling. Check for runaway processes or blocked vents.".into(),
                });
            }
            if self.gpu_temp.update(s.health.gpu_temp, HOT_C, sustain, now) {
                out.push(Notification {
                    title: format!("GPU is running hot: {:.0}°C", s.health.gpu_temp.unwrap_or_default()),
                    body: "Sustained high GPU temperatures can cause throttling.".into(),
                });
            }
        }

        for d in &s.disks {
            let armed = self.disk_armed.entry(d.mount_point.clone()).or_insert(true);
            if d.usage_pct < c.disk_pct - HYSTERESIS {
                *armed = true;
                continue;
            }
            if d.usage_pct < c.disk_pct || !*armed {
                continue;
            }
            let last = self.disk_last.get(&d.mount_point).copied();
            if last.map(|t| now.saturating_sub(t) >= DISK_COOLDOWN_MS).unwrap_or(true) {
                self.disk_last.insert(d.mount_point.clone(), now);
                *armed = false;
                out.push(Notification {
                    title: format!("Disk {} is {:.0}% full", d.mount_point, d.usage_pct),
                    body: format!(
                        "{} free. Open ResourceScope's storage examiner to see what's using space.",
                        human_bytes(d.available_bytes)
                    ),
                });
            }
        }

        if c.low_battery {
            if let Some(b) = s.batteries.first() {
                if b.state == "discharging" {
                    let level = if b.charge_pct <= 10.0 { Some(10) } else if b.charge_pct <= 20.0 { Some(20) } else { None };
                    if let Some(level) = level {
                        if self.battery_warned_at.is_none_or(|w| level < w) {
                            self.battery_warned_at = Some(level);
                            out.push(Notification {
                                title: format!("Battery low: {:.0}%", b.charge_pct),
                                body: match b.time_to_empty_secs {
                                    Some(secs) => format!("About {} remaining. Plug in soon.", human_secs(secs)),
                                    None => "Plug in soon.".into(),
                                },
                            });
                        }
                    }
                } else if b.state == "charging" || b.state == "full" {
                    self.battery_warned_at = None;
                }
            }
        }
        out
    }
}

fn human_bytes(b: u64) -> String {
    let v = b as f64;
    if v >= 1e12 {
        format!("{:.1} TB", v / 1e12)
    } else if v >= 1e9 {
        format!("{:.1} GB", v / 1e9)
    } else if v >= 1e6 {
        format!("{:.0} MB", v / 1e6)
    } else {
        format!("{:.0} KB", v / 1e3)
    }
}

fn human_secs(secs: u64) -> String {
    match secs {
        0..=59 => format!("{secs} seconds"),
        60..=119 => "1 minute".into(),
        120..=3599 => format!("{} minutes", secs / 60),
        _ => format!("{}h {}m", secs / 3600, (secs % 3600) / 60),
    }
}

fn top_process_hint(
    s: &MetricsSnapshot,
    key: impl Fn(&crate::processes::ProcessInfo) -> f64,
    describe: impl Fn(&crate::processes::ProcessInfo) -> String,
) -> String {
    s.processes
        .iter()
        .max_by(|a, b| key(a).total_cmp(&key(b)))
        .map(|p| format!(" Top: {} ({}).", p.friendly_name.as_deref().unwrap_or(&p.name), describe(p)))
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn engine(sustain_secs: u64) -> AlertEngine {
        AlertEngine {
            config: AlertConfig { enabled: true, sustain_secs, ..Default::default() },
            ..Default::default()
        }
    }

    #[test]
    fn sustained_requires_duration_and_rearms_with_hysteresis() {
        let mut s = Sustained::default();
        let t0 = 1_000_000;
        assert!(!s.update(Some(90.0), 80.0, 60_000, t0));
        assert!(!s.update(Some(90.0), 80.0, 60_000, t0 + 30_000));
        assert!(s.update(Some(90.0), 80.0, 60_000, t0 + 60_000));
        // Stays high: no repeat.
        assert!(!s.update(Some(95.0), 80.0, 60_000, t0 + 200_000));
        // Dips just under the line: still not re-armed (hysteresis).
        assert!(!s.update(Some(78.0), 80.0, 60_000, t0 + 210_000));
        assert!(!s.update(Some(90.0), 80.0, 60_000, t0 + 400_000));
        // Drops well below, then high again, but within cooldown.
        assert!(!s.update(Some(50.0), 80.0, 60_000, t0 + 410_000));
        assert!(!s.update(Some(90.0), 80.0, 60_000, t0 + 420_000));
        assert!(!s.update(Some(90.0), 80.0, 60_000, t0 + 490_000));
        // After the cooldown it can fire again.
        assert!(s.update(Some(90.0), 80.0, 60_000, t0 + 60_000 + COOLDOWN_MS + 60_000));
    }

    #[test]
    fn human_units() {
        assert_eq!(human_bytes(24_300_000), "24 MB");
        assert_eq!(human_bytes(15_000_000_000), "15.0 GB");
        assert_eq!(human_secs(30), "30 seconds");
        assert_eq!(human_secs(300), "5 minutes");
        assert_eq!(human_secs(5400), "1h 30m");
    }

    #[test]
    fn brief_spike_does_not_alert() {
        let mut s = Sustained::default();
        assert!(!s.update(Some(99.0), 80.0, 60_000, 0));
        assert!(!s.update(Some(10.0), 80.0, 60_000, 30_000));
        assert!(!s.update(Some(99.0), 80.0, 60_000, 40_000));
        assert!(!s.update(Some(99.0), 80.0, 60_000, 90_000));
        assert!(s.update(Some(99.0), 80.0, 60_000, 100_000));
    }

    #[test]
    fn disabled_engine_is_silent() {
        let mut e = AlertEngine::default();
        let mut snap = crate::metrics::tests::fake_snapshot();
        snap.cpu.usage_pct = 100.0;
        for i in 0..10 {
            assert!(e.evaluate(&snap, i * 60_000).is_empty());
        }
    }

    #[test]
    fn cpu_alert_names_top_process() {
        let mut e = engine(0);
        let mut snap = crate::metrics::tests::fake_snapshot();
        snap.cpu.usage_pct = 97.0;
        let out = e.evaluate(&snap, 1_000);
        assert_eq!(out.len(), 1, "{out:?}");
        assert!(out[0].title.contains("97%"));
        assert!(out[0].body.contains("Top: busy"), "{}", out[0].body);
    }

    #[test]
    fn disk_and_battery_alerts_fire_once() {
        let mut e = engine(60);
        let mut snap = crate::metrics::tests::fake_snapshot();
        snap.disks[0].usage_pct = 95.0;
        snap.batteries.push(crate::battery::BatteryInfo {
            charge_pct: 18.0,
            state: "discharging".into(),
            time_to_empty_secs: Some(1800),
            time_to_full_secs: None,
            health_pct: 90.0,
            power_w: 8.0,
            cycle_count: None,
            temperature_c: None,
            vendor: None,
            model: None,
        });
        let first = e.evaluate(&snap, 1_000);
        assert_eq!(first.len(), 2, "{first:?}");
        assert!(e.evaluate(&snap, 2_000).is_empty());
        // Battery keeps draining past 10%: one more warning.
        snap.batteries[0].charge_pct = 9.0;
        let second = e.evaluate(&snap, 3_000);
        assert_eq!(second.len(), 1);
        assert!(second[0].title.contains("9%"));
        // Plugged in, then unplugged again at 19%: warns again.
        snap.batteries[0].state = "charging".into();
        assert!(e.evaluate(&snap, 4_000).is_empty());
        snap.batteries[0].state = "discharging".into();
        snap.batteries[0].charge_pct = 19.0;
        assert_eq!(e.evaluate(&snap, 5_000).len(), 1);
    }
}
