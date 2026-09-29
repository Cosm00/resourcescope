//! GPU busy % for Linux drivers without a `gpu_busy_percent` sysfs file —
//! Intel's i915 and xe.
//!
//! Two sources, best first:
//!  1. The i915 PMU (`perf_event_open` on the `*-busy` engine counters), the
//!     same counters `intel_gpu_top` reads. System-wide, but needs root,
//!     CAP_PERFMON or `kernel.perf_event_paranoid <= 0`.
//!  2. DRM fdinfo (`/proc/<pid>/fdinfo/<fd>`, kernel 5.19+ for i915, 6.8+ for
//!     xe): per-client engine busy time. Unprivileged, but only covers the
//!     processes we may inspect — normally all of the user's own, which on a
//!     desktop includes the compositor and apps.
//!
//! Both are cumulative counters; utilization is the delta between two samples,
//! so the first call per GPU returns `None`.

use std::collections::HashMap;

/// Per-engine counter as reported by a DRM client's fdinfo.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum EngineCounter {
    /// i915 (and amdgpu, msm, …): `drm-engine-<name>: <busy> ns`, with
    /// `drm-engine-capacity-<name>: <n>` when an engine class has several
    /// instances.
    Ns { busy_ns: u64, capacity: u32 },
    /// xe: `drm-cycles-<class>` against `drm-total-cycles-<class>` (the GPU
    /// timestamp), so wall-clock time doesn't matter.
    Cycles { cycles: u64, total: u64 },
}

#[derive(Clone, Debug, PartialEq)]
pub struct DrmClient {
    pub driver: String,
    pub pdev: String,
    pub client_id: u64,
    pub engines: HashMap<String, EngineCounter>,
}

/// Parse one DRM fdinfo file. `None` for non-DRM fds and clients without
/// engine statistics.
pub fn parse_fdinfo(text: &str) -> Option<DrmClient> {
    let mut driver = None;
    let mut pdev = None;
    let mut client_id = None;
    let mut busy: HashMap<String, u64> = HashMap::new();
    let mut capacity: HashMap<String, u32> = HashMap::new();
    let mut cycles: HashMap<String, u64> = HashMap::new();
    let mut total: HashMap<String, u64> = HashMap::new();

    for line in text.lines() {
        let Some((key, value)) = line.split_once(':') else { continue };
        let value = value.trim();
        let number = || value.split_whitespace().next().and_then(|v| v.parse::<u64>().ok());
        match key.trim() {
            "drm-driver" => driver = Some(value.to_string()),
            "drm-pdev" => pdev = Some(value.to_ascii_lowercase()),
            "drm-client-id" => client_id = number(),
            key => {
                if let Some(engine) = key.strip_prefix("drm-engine-capacity-") {
                    if let Some(n) = number() {
                        capacity.insert(engine.to_string(), n.max(1) as u32);
                    }
                } else if let Some(engine) = key.strip_prefix("drm-engine-") {
                    if let Some(n) = number() {
                        busy.insert(engine.to_string(), n);
                    }
                } else if let Some(class) = key.strip_prefix("drm-total-cycles-") {
                    if let Some(n) = number() {
                        total.insert(class.to_string(), n);
                    }
                } else if let Some(class) = key.strip_prefix("drm-cycles-") {
                    if let Some(n) = number() {
                        cycles.insert(class.to_string(), n);
                    }
                }
            }
        }
    }

    let mut engines: HashMap<String, EngineCounter> = busy
        .into_iter()
        .map(|(name, busy_ns)| {
            let capacity = capacity.get(&name).copied().unwrap_or(1);
            (name, EngineCounter::Ns { busy_ns, capacity })
        })
        .collect();
    for (class, cycles) in cycles {
        if let Some(&total) = total.get(&class) {
            engines.insert(class, EngineCounter::Cycles { cycles, total });
        }
    }
    if engines.is_empty() {
        return None;
    }
    Some(DrmClient { driver: driver?, pdev: pdev.unwrap_or_default(), client_id: client_id?, engines })
}

/// Busiest engine's utilization (0–100) on `pdev` between two fdinfo scans
/// taken `elapsed_ns` apart. Only clients present in both scans count; a
/// brand-new client is picked up from the next interval on. `None` when no
/// client of that device was seen twice.
pub fn fdinfo_utilization(
    prev: &HashMap<(String, u64), DrmClient>,
    cur: &HashMap<(String, u64), DrmClient>,
    pdev: &str,
    elapsed_ns: u64,
) -> Option<f32> {
    if elapsed_ns == 0 {
        return None;
    }
    // Per engine: (summed busy ns, capacity) or (summed cycles, GPU timestamp delta).
    let mut ns: HashMap<&str, (u64, u32)> = HashMap::new();
    let mut cyc: HashMap<&str, (u64, u64)> = HashMap::new();
    let mut seen = false;
    for (key, client) in cur {
        if client.pdev != pdev {
            continue;
        }
        let Some(before) = prev.get(key) else { continue };
        seen = true;
        for (engine, counter) in &client.engines {
            match (counter, before.engines.get(engine)) {
                (EngineCounter::Ns { busy_ns, capacity }, Some(EngineCounter::Ns { busy_ns: b, .. })) => {
                    let e = ns.entry(engine.as_str()).or_insert((0, *capacity));
                    e.0 += busy_ns.saturating_sub(*b);
                    e.1 = e.1.max(*capacity);
                }
                (EngineCounter::Cycles { cycles, total }, Some(EngineCounter::Cycles { cycles: c, total: t })) => {
                    let e = cyc.entry(engine.as_str()).or_insert((0, 0));
                    e.0 += cycles.saturating_sub(*c);
                    // Every client of a GT reads the same timestamp.
                    e.1 = e.1.max(total.saturating_sub(*t));
                }
                _ => {}
            }
        }
    }
    if !seen {
        return None;
    }
    let from_ns = ns
        .values()
        .map(|&(busy, cap)| busy as f64 / (elapsed_ns as f64 * cap.max(1) as f64));
    let from_cycles = cyc
        .values()
        .filter(|&&(_, total)| total > 0)
        .map(|&(cycles, total)| cycles as f64 / total as f64);
    let busiest = from_ns.chain(from_cycles).fold(0.0f64, f64::max);
    Some((busiest * 100.0).clamp(0.0, 100.0) as f32)
}

/// Parse a perf event spec from sysfs, e.g. `config=0x0000000000000000`.
pub fn parse_pmu_config(spec: &str) -> Option<u64> {
    spec.trim().split(',').find_map(|part| {
        let value = part.trim().strip_prefix("config=")?;
        match value.strip_prefix("0x") {
            Some(hex) => u64::from_str_radix(hex, 16).ok(),
            None => value.parse().ok(),
        }
    })
}

/// PMU busy counters are nanoseconds per engine: utilization is the busiest
/// engine's share of the wall-clock interval.
pub fn pmu_utilization(prev: &[u64], cur: &[u64], elapsed_ns: u64) -> Option<f32> {
    if elapsed_ns == 0 || prev.len() != cur.len() || cur.is_empty() {
        return None;
    }
    let busiest = prev
        .iter()
        .zip(cur)
        .map(|(a, b)| b.saturating_sub(*a) as f64 / elapsed_ns as f64)
        .fold(0.0f64, f64::max);
    Some((busiest * 100.0).clamp(0.0, 100.0) as f32)
}

#[cfg(target_os = "linux")]
pub use linux::busy_pct;

#[cfg(target_os = "linux")]
mod linux {
    use super::*;
    use std::fs::{self, File};
    use std::io::Read;
    use std::os::fd::{FromRawFd, OwnedFd};
    use std::path::Path;
    use std::sync::Mutex;
    use std::time::Instant;

    type ClientMap = HashMap<(String, u64), DrmClient>;

    enum Pmu {
        Ready { counters: Vec<File>, last: Option<(Instant, Vec<u64>)> },
        Unavailable,
    }

    #[derive(Default)]
    struct State {
        pmu: HashMap<String, Pmu>,
        fdinfo_last: Option<(Instant, ClientMap)>,
    }

    static STATE: Mutex<Option<State>> = Mutex::new(None);

    /// Busy % for the GPU at PCI address `pci` (e.g. `0000:00:02.0`) bound to
    /// `driver`, plus a short description of the source. `None` until two
    /// samples exist or when no source works.
    pub fn busy_pct(pci: &str, driver: &str) -> Option<(f32, &'static str)> {
        let mut guard = STATE.lock().unwrap_or_else(|p| p.into_inner());
        let state = guard.get_or_insert_with(State::default);
        let pci = pci.to_ascii_lowercase();

        if driver == "i915" {
            let pmu = state.pmu.entry(pci.clone()).or_insert_with(|| open_pmu(&pci));
            if let Pmu::Ready { counters, last } = pmu {
                if let Some(values) = read_counters(counters) {
                    let now = Instant::now();
                    let result = last.as_ref().and_then(|(t, prev)| {
                        pmu_utilization(prev, &values, now.duration_since(*t).as_nanos() as u64)
                    });
                    *last = Some((now, values));
                    // With a working PMU, skip the (costlier) fdinfo scan even
                    // on the first, baseline-only call.
                    return result.map(|pct| (pct, "i915 PMU"));
                }
                *pmu = Pmu::Unavailable;
            }
        }

        let now = Instant::now();
        let clients = scan_fdinfo();
        let result = state.fdinfo_last.as_ref().and_then(|(t, prev)| {
            fdinfo_utilization(prev, &clients, &pci, now.duration_since(*t).as_nanos() as u64)
        });
        state.fdinfo_last = Some((now, clients));
        result.map(|pct| (pct, "DRM fdinfo"))
    }

    /// The i915 PMU of a device: `i915_0000_03_00.0` for discrete cards and
    /// plain `i915` for the integrated GPU.
    fn pmu_dir(pci: &str) -> Option<std::path::PathBuf> {
        let base = Path::new("/sys/bus/event_source/devices");
        let specific = base.join(format!("i915_{}", pci.replace(':', "_")));
        if specific.is_dir() {
            return Some(specific);
        }
        // The unsuffixed PMU belongs to the integrated GPU (always 00:02.0);
        // a discrete card must not borrow its numbers.
        let plain = base.join("i915");
        (pci.ends_with(":00:02.0") && plain.is_dir()).then_some(plain)
    }

    fn open_pmu(pci: &str) -> Pmu {
        let Some(dir) = pmu_dir(pci) else { return Pmu::Unavailable };
        let Some(pmu_type) = fs::read_to_string(dir.join("type")).ok().and_then(|s| s.trim().parse::<u32>().ok()) else {
            return Pmu::Unavailable;
        };
        // Uncore-style PMUs must be opened on the CPU listed in `cpumask`.
        let cpu = fs::read_to_string(dir.join("cpumask"))
            .ok()
            .and_then(|s| s.trim().split([',', '-']).next().and_then(|c| c.parse::<i32>().ok()))
            .unwrap_or(0);
        let Ok(events) = fs::read_dir(dir.join("events")) else { return Pmu::Unavailable };
        let mut counters = Vec::new();
        for event in events.flatten() {
            let name = event.file_name().to_string_lossy().to_string();
            if !name.ends_with("-busy") {
                continue;
            }
            let Some(config) = fs::read_to_string(event.path()).ok().as_deref().and_then(parse_pmu_config) else { continue };
            match perf_event_open(pmu_type, config, cpu) {
                Some(file) => counters.push(file),
                // EACCES/EPERM: not privileged — the fdinfo path takes over.
                None => return Pmu::Unavailable,
            }
        }
        if counters.is_empty() {
            Pmu::Unavailable
        } else {
            Pmu::Ready { counters, last: None }
        }
    }

    /// `perf_event_attr` truncated to PERF_ATTR_SIZE_VER0; the kernel accepts
    /// any published size and treats the missing tail as zero.
    #[repr(C)]
    struct PerfEventAttr {
        type_: u32,
        size: u32,
        config: u64,
        rest: [u64; 6],
    }

    fn perf_event_open(pmu_type: u32, config: u64, cpu: i32) -> Option<File> {
        const PERF_FLAG_FD_CLOEXEC: libc::c_ulong = 8;
        let attr = PerfEventAttr {
            type_: pmu_type,
            size: std::mem::size_of::<PerfEventAttr>() as u32,
            config,
            rest: [0; 6],
        };
        // pid -1 + a CPU: count system-wide, as the uncore PMU requires.
        let fd = unsafe {
            libc::syscall(libc::SYS_perf_event_open, &attr as *const PerfEventAttr, -1 as libc::pid_t, cpu, -1 as libc::c_int, PERF_FLAG_FD_CLOEXEC)
        };
        if fd < 0 {
            return None;
        }
        Some(File::from(unsafe { OwnedFd::from_raw_fd(fd as i32) }))
    }

    fn read_counters(counters: &mut [File]) -> Option<Vec<u64>> {
        counters
            .iter_mut()
            .map(|f| {
                let mut buf = [0u8; 8];
                f.read_exact(&mut buf).ok()?;
                Some(u64::from_ne_bytes(buf))
            })
            .collect()
    }

    #[cfg(test)]
    #[test]
    fn perf_event_open_reads_a_counter_when_permitted() {
        // PERF_TYPE_SOFTWARE / PERF_COUNT_SW_CPU_CLOCK: exercises the syscall
        // wrapper and attr layout on any Linux box. Skips without privileges.
        let Some(file) = perf_event_open(1, 0, 0) else { return };
        let mut counters = vec![file];
        let a = read_counters(&mut counters).unwrap()[0];
        std::thread::sleep(std::time::Duration::from_millis(20));
        let b = read_counters(&mut counters).unwrap()[0];
        assert!(b > a, "{a} -> {b}");
    }

    /// Every DRM client we can see, de-duplicated by (device, client id): a
    /// client's fd can be shared across processes or dup'ed.
    fn scan_fdinfo() -> ClientMap {
        let mut clients = ClientMap::new();
        let Ok(procs) = fs::read_dir("/proc") else { return clients };
        for proc_entry in procs.flatten() {
            let pid = proc_entry.file_name();
            if !pid.to_string_lossy().bytes().all(|b| b.is_ascii_digit()) {
                continue;
            }
            // Other users' processes fail here without privileges; skip them.
            let Ok(fds) = fs::read_dir(proc_entry.path().join("fd")) else { continue };
            for fd in fds.flatten() {
                // Cheap filter first: only fds that point at a DRM node.
                let is_drm = fs::read_link(fd.path()).is_ok_and(|t| t.starts_with("/dev/dri/"));
                if !is_drm {
                    continue;
                }
                let info = proc_entry.path().join("fdinfo").join(fd.file_name());
                if let Some(client) = fs::read_to_string(info).ok().as_deref().and_then(parse_fdinfo) {
                    clients.insert((client.pdev.clone(), client.client_id), client);
                }
            }
        }
        clients
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const I915: &str = "pos:\t0\nflags:\t02100002\nmnt_id:\t26\nino:\t1023\ndrm-driver:\ti915\ndrm-client-id:\t7\ndrm-pdev:\t0000:00:02.0\ndrm-total-system0:\t1024 KiB\ndrm-engine-render:\t2000000 ns\ndrm-engine-copy:\t0 ns\ndrm-engine-video:\t500000 ns\ndrm-engine-capacity-video:\t2\ndrm-engine-video-enhance:\t0 ns\n";

    const XE: &str = "drm-driver:\txe\ndrm-client-id:\t12\ndrm-pdev:\t0000:03:00.0\ndrm-total-system:\t0\ndrm-cycles-rcs:\t1000\ndrm-total-cycles-rcs:\t100000\ndrm-cycles-bcs:\t0\ndrm-total-cycles-bcs:\t100000\n";

    fn map(clients: &[DrmClient]) -> HashMap<(String, u64), DrmClient> {
        clients.iter().map(|c| ((c.pdev.clone(), c.client_id), c.clone())).collect()
    }

    #[test]
    fn parses_i915_fdinfo() {
        let c = parse_fdinfo(I915).unwrap();
        assert_eq!(c.driver, "i915");
        assert_eq!(c.pdev, "0000:00:02.0");
        assert_eq!(c.client_id, 7);
        assert_eq!(c.engines["render"], EngineCounter::Ns { busy_ns: 2_000_000, capacity: 1 });
        assert_eq!(c.engines["video"], EngineCounter::Ns { busy_ns: 500_000, capacity: 2 });
        // `drm-engine-capacity-*` is not an engine of its own.
        assert!(!c.engines.contains_key("capacity-video"));
    }

    #[test]
    fn parses_xe_fdinfo() {
        let c = parse_fdinfo(XE).unwrap();
        assert_eq!(c.driver, "xe");
        assert_eq!(c.engines["rcs"], EngineCounter::Cycles { cycles: 1000, total: 100_000 });
    }

    #[test]
    fn ignores_non_drm_and_statless_fds() {
        assert!(parse_fdinfo("pos:\t0\nflags:\t02\nmnt_id:\t1\n").is_none());
        assert!(parse_fdinfo("drm-driver:\ti915\ndrm-client-id:\t3\ndrm-pdev:\t0000:00:02.0\n").is_none());
    }

    #[test]
    fn ns_utilization_sums_clients_and_respects_capacity() {
        let a0 = parse_fdinfo(I915).unwrap();
        let mut b0 = a0.clone();
        b0.client_id = 8;
        let mut a1 = a0.clone();
        let mut b1 = b0.clone();
        // Over 100 ms: render busy 30 ms (client a) + 20 ms (client b) = 50%.
        a1.engines.insert("render".into(), EngineCounter::Ns { busy_ns: 2_000_000 + 30_000_000, capacity: 1 });
        b1.engines.insert("render".into(), EngineCounter::Ns { busy_ns: 2_000_000 + 20_000_000, capacity: 1 });
        // Video: 2 instances, 80 ms busy → 40%, less than render.
        a1.engines.insert("video".into(), EngineCounter::Ns { busy_ns: 500_000 + 80_000_000, capacity: 2 });
        let pct = fdinfo_utilization(&map(&[a0.clone(), b0]), &map(&[a1, b1]), "0000:00:02.0", 100_000_000).unwrap();
        assert!((pct - 50.0).abs() < 0.01, "{pct}");
        // Other device → no data.
        assert_eq!(fdinfo_utilization(&map(std::slice::from_ref(&a0)), &map(&[a0]), "0000:03:00.0", 100_000_000), None);
    }

    #[test]
    fn cycles_utilization_uses_gpu_timestamp() {
        let c0 = parse_fdinfo(XE).unwrap();
        let mut c1 = c0.clone();
        c1.engines.insert("rcs".into(), EngineCounter::Cycles { cycles: 1000 + 25_000, total: 100_000 + 100_000 });
        let pct = fdinfo_utilization(&map(&[c0]), &map(&[c1]), "0000:03:00.0", 1).unwrap();
        assert!((pct - 25.0).abs() < 0.01, "{pct}");
    }

    #[test]
    fn new_clients_are_ignored_until_seen_twice() {
        let c = parse_fdinfo(I915).unwrap();
        assert_eq!(fdinfo_utilization(&HashMap::new(), &map(&[c]), "0000:00:02.0", 1_000), None);
    }

    #[test]
    fn pmu_helpers() {
        assert_eq!(parse_pmu_config("config=0x0000000000000000\n"), Some(0));
        assert_eq!(parse_pmu_config("config=0x1001"), Some(0x1001));
        assert_eq!(parse_pmu_config("event=0x02,config=12"), Some(12));
        assert_eq!(parse_pmu_config("event=0x02"), None);
        // 2 engines over 1 s: 250 ms and 900 ms busy → 90%.
        assert_eq!(pmu_utilization(&[0, 100], &[250_000_000, 900_000_100], 1_000_000_000), Some(90.0));
        assert_eq!(pmu_utilization(&[0], &[1, 2], 10), None);
    }
}
