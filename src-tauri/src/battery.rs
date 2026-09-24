//! Laptop battery status via `starship-battery` (macOS IOKit, Windows
//! SetupAPI/IOCTL, Linux `/sys/class/power_supply`). Desktops simply report
//! no batteries.

use serde::Serialize;
use starship_battery::units::{power::watt, ratio::percent, thermodynamic_temperature::degree_celsius, time::second};
use starship_battery::{Manager, State};
use std::time::{Duration, Instant};

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct BatteryInfo {
    pub charge_pct: f32,
    /// "charging" | "discharging" | "full" | "empty" | "unknown"
    pub state: String,
    pub time_to_empty_secs: Option<u64>,
    pub time_to_full_secs: Option<u64>,
    /// Current full capacity as a percentage of design capacity.
    pub health_pct: f32,
    /// Charge/discharge power in watts (always positive).
    pub power_w: f32,
    pub cycle_count: Option<u32>,
    pub temperature_c: Option<f32>,
    pub vendor: Option<String>,
    pub model: Option<String>,
}

/// Battery state changes slowly and some platforms query hardware over ACPI,
/// so it is sampled far less often than CPU/memory.
const REFRESH_EVERY: Duration = Duration::from_secs(10);

pub struct BatteryCollector {
    cached: Vec<BatteryInfo>,
    last_refresh: Option<Instant>,
    /// Stop polling after the manager fails to initialise (e.g. no power
    /// supply class in a container); a laptop always has one.
    unavailable: bool,
}

impl BatteryCollector {
    pub fn new() -> Self {
        Self { cached: Vec::new(), last_refresh: None, unavailable: false }
    }

    pub fn collect(&mut self) -> Vec<BatteryInfo> {
        let due = self.last_refresh.map(|t| t.elapsed() >= REFRESH_EVERY).unwrap_or(true);
        if due && !self.unavailable {
            self.last_refresh = Some(Instant::now());
            // A fresh Manager each time keeps the collector `Send` on every
            // platform (IOKit handles are not) and picks up hot-swapped packs.
            match read_batteries() {
                Some(list) => self.cached = list,
                None => self.unavailable = true,
            }
        }
        self.cached.clone()
    }
}

fn read_batteries() -> Option<Vec<BatteryInfo>> {
    let manager = Manager::new().ok()?;
    let batteries = manager.batteries().ok()?;
    Some(
        batteries
            .flatten()
            .map(|b| {
                let finite = |v: f32| if v.is_finite() { Some(v) } else { None };
                let secs = |t: Option<starship_battery::units::Time>| {
                    t.map(|t| t.get::<second>()).and_then(finite).filter(|s| *s > 0.0).map(|s| s as u64)
                };
                BatteryInfo {
                    charge_pct: finite(b.state_of_charge().get::<percent>()).unwrap_or(0.0).clamp(0.0, 100.0),
                    state: state_label(b.state()).to_string(),
                    time_to_empty_secs: secs(b.time_to_empty()),
                    time_to_full_secs: secs(b.time_to_full()),
                    health_pct: finite(b.state_of_health().get::<percent>()).unwrap_or(0.0).clamp(0.0, 150.0),
                    power_w: finite(b.energy_rate().get::<watt>()).unwrap_or(0.0).abs(),
                    cycle_count: b.cycle_count(),
                    temperature_c: b.temperature().map(|t| t.get::<degree_celsius>()).and_then(finite),
                    vendor: b.vendor().map(|s| s.trim().to_string()).filter(|s| !s.is_empty()),
                    model: b.model().map(|s| s.trim().to_string()).filter(|s| !s.is_empty()),
                }
            })
            .collect(),
    )
}

fn state_label(state: State) -> &'static str {
    match state {
        State::Charging => "charging",
        State::Discharging => "discharging",
        State::Full => "full",
        State::Empty => "empty",
        _ => "unknown",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn collector_never_panics_and_caches() {
        let mut c = BatteryCollector::new();
        let first = c.collect();
        // Second call inside the refresh window returns the cached value.
        assert_eq!(first, c.collect());
        for b in first {
            assert!((0.0..=100.0).contains(&b.charge_pct));
        }
    }
}
