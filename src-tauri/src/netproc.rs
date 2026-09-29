//! Per-process network throughput. Operating systems don't keep per-process
//! byte counters the way they do for disk I/O, so each platform needs its own
//! source:
//!
//! * **Linux** — `NETLINK_SOCK_DIAG` dumps every TCP socket with its
//!   `tcp_info` byte counters (what `ss -ti` shows, no privileges needed);
//!   sockets are mapped to processes through `/proc/<pid>/fd`. TCP only —
//!   the kernel keeps no per-socket UDP byte counts — and without root only
//!   your own processes can be mapped.
//! * **macOS** — `nettop` (ships with the OS, works unprivileged) sampled in
//!   delta mode on a background thread.
//! * **Windows** — an ETW session on the Microsoft-Windows-Kernel-Network
//!   provider (TCP + UDP send/receive events). Starting one needs
//!   administrator rights (or membership in "Performance Log Users").
//!
//! Loopback traffic is excluded everywhere, matching the interface totals.

use serde::Serialize;
use std::collections::HashMap;

/// Cumulative (received, transmitted) bytes per key (socket inode or PID).
/// (macOS gets deltas from nettop directly.)
#[cfg_attr(target_os = "macos", allow(dead_code))]
type ByteCounters<K> = HashMap<K, (u64, u64)>;

/// Receive / transmit rate in bytes per second.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct NetRate {
    pub rx_bps: u64,
    pub tx_bps: u64,
}

/// What the UI should say about per-process network numbers.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct ProcNetStatus {
    pub available: bool,
    /// Short description of what's counted, e.g. "TCP".
    pub scope: String,
    pub note: Option<String>,
}

pub struct NetProcCollector {
    inner: platform::Collector,
}

impl NetProcCollector {
    pub fn new() -> Self {
        Self { inner: platform::Collector::new() }
    }

    /// Current rates per PID. The first call only establishes a baseline.
    pub fn sample(&mut self) -> HashMap<u32, NetRate> {
        self.inner.sample()
    }

    pub fn status(&self) -> ProcNetStatus {
        self.inner.status()
    }
}

/// Release OS resources that outlive the process (the Windows ETW session).
pub fn shutdown() {
    #[cfg(windows)]
    platform::shutdown();
}

/// Turn cumulative per-key byte counters into per-PID rates.
/// `owner` resolves a key (socket inode, PID, …) to its PID.
#[cfg_attr(target_os = "macos", allow(dead_code))]
fn rates_from_counters<K: std::hash::Hash + Eq + Copy>(
    prev: &HashMap<K, (u64, u64)>,
    cur: &HashMap<K, (u64, u64)>,
    dt_secs: f64,
    mut owner: impl FnMut(K) -> Option<u32>,
) -> HashMap<u32, NetRate> {
    let mut out: HashMap<u32, NetRate> = HashMap::new();
    if dt_secs <= 0.0 {
        return out;
    }
    for (key, &(rx, tx)) in cur {
        // New keys have no baseline; counters that went backwards (reused
        // inode, restarted session) are skipped rather than reported huge.
        let Some(&(prx, ptx)) = prev.get(key) else { continue };
        let (drx, dtx) = (rx.saturating_sub(prx), tx.saturating_sub(ptx));
        if drx == 0 && dtx == 0 {
            continue;
        }
        let Some(pid) = owner(*key) else { continue };
        let e = out.entry(pid).or_default();
        e.rx_bps += (drx as f64 / dt_secs) as u64;
        e.tx_bps += (dtx as f64 / dt_secs) as u64;
    }
    out
}

fn is_loopback_v4(addr: [u8; 4]) -> bool {
    addr[0] == 127
}

fn is_loopback_v6(addr: [u8; 16]) -> bool {
    let v4_mapped = addr[..10].iter().all(|b| *b == 0) && addr[10] == 0xff && addr[11] == 0xff;
    addr == std::net::Ipv6Addr::LOCALHOST.octets() || (v4_mapped && addr[12] == 127)
}

// ─── Linux: sock_diag ────────────────────────────────────────────────────────

const AF_INET: u8 = 2;
const AF_INET6: u8 = 10;
const NLMSG_ERROR: u16 = 2;
const NLMSG_DONE: u16 = 3;
const INET_DIAG_INFO: u16 = 2;
/// Offsets of `tcpi_bytes_acked` / `tcpi_bytes_received` in `struct tcp_info`.
const TCPI_BYTES_ACKED: usize = 120;
const TCPI_BYTES_RECEIVED: usize = 128;

/// One TCP socket from a sock_diag dump.
#[derive(Debug, PartialEq, Eq)]
pub struct DiagSocket {
    pub inode: u32,
    pub rx: u64,
    pub tx: u64,
}

/// How a buffer of a sock_diag dump ended.
#[derive(Debug, PartialEq, Eq)]
pub enum DumpEnd {
    /// More messages follow in the next `recv`.
    More,
    Done,
    /// The kernel aborted the dump (`NLMSG_ERROR`); the data is partial.
    Error,
}

/// Parse a buffer of netlink messages from a `SOCK_DIAG_BY_FAMILY` dump.
/// Loopback sockets and sockets without an inode (TIME_WAIT) are skipped.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub fn parse_diag_dump(buf: &[u8]) -> (Vec<DiagSocket>, DumpEnd) {
    let u16_at = |b: &[u8], o: usize| u16::from_ne_bytes([b[o], b[o + 1]]);
    let u32_at = |b: &[u8], o: usize| u32::from_ne_bytes(b[o..o + 4].try_into().unwrap());
    let u64_at = |b: &[u8], o: usize| u64::from_ne_bytes(b[o..o + 8].try_into().unwrap());
    let align4 = |n: usize| (n + 3) & !3;

    let mut sockets = Vec::new();
    let mut off = 0;
    while off + 16 <= buf.len() {
        let len = u32_at(buf, off) as usize;
        let kind = u16_at(buf, off + 4);
        if len < 16 || off + len > buf.len() {
            break;
        }
        if kind == NLMSG_DONE {
            return (sockets, DumpEnd::Done);
        }
        if kind == NLMSG_ERROR {
            return (sockets, DumpEnd::Error);
        }
        // struct inet_diag_msg (72 bytes) follows the 16-byte header.
        let msg = &buf[off + 16..off + len];
        if msg.len() >= 72 {
            let family = msg[0];
            let loopback = match family {
                AF_INET => is_loopback_v4(msg[24..28].try_into().unwrap()),
                AF_INET6 => is_loopback_v6(msg[24..40].try_into().unwrap()),
                _ => true,
            };
            let inode = u32_at(msg, 68);
            // rtattrs after the fixed message.
            let mut a = 72;
            while a + 4 <= msg.len() {
                let alen = u16_at(msg, a) as usize;
                let atype = u16_at(msg, a + 2);
                if alen < 4 || a + alen > msg.len() {
                    break;
                }
                let data = &msg[a + 4..a + alen];
                if atype == INET_DIAG_INFO && data.len() >= TCPI_BYTES_RECEIVED + 8 && inode != 0 && !loopback {
                    sockets.push(DiagSocket {
                        inode,
                        tx: u64_at(data, TCPI_BYTES_ACKED),
                        rx: u64_at(data, TCPI_BYTES_RECEIVED),
                    });
                }
                a += align4(alen);
            }
        }
        off += align4(len);
    }
    (sockets, DumpEnd::More)
}

/// Parse `/proc/<pid>/fd/<n>` link targets like `socket:[12345]`.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub fn socket_inode(link: &str) -> Option<u32> {
    link.strip_prefix("socket:[")?.strip_suffix(']')?.parse().ok()
}

#[cfg(target_os = "linux")]
mod platform {
    use super::*;
    use std::fs;
    use std::time::Instant;

    pub struct Collector {
        prev: Option<(Instant, ByteCounters<u32>)>,
        /// Socket inode → owning PID, refreshed when an active socket is unknown.
        owners: HashMap<u32, u32>,
        /// Active sockets a scan couldn't attribute (other users' processes
        /// without root); they don't trigger another scan.
        unowned: std::collections::HashSet<u32>,
        last_scan: Option<Instant>,
        /// Consecutive failed dumps; one hiccup (EINTR, timeout) shouldn't
        /// make the UI drop the Network column.
        failures: u32,
    }

    /// New sockets appear constantly (browsers); cap the /proc walk rate.
    const MIN_SCAN_INTERVAL: std::time::Duration = std::time::Duration::from_secs(2);

    impl Collector {
        pub fn new() -> Self {
            Self { prev: None, owners: HashMap::new(), unowned: Default::default(), last_scan: None, failures: 0 }
        }

        pub fn sample(&mut self) -> HashMap<u32, NetRate> {
            let Some(sockets) = dump_tcp() else {
                // Keep the previous baseline for the next successful dump.
                self.failures += 1;
                return HashMap::new();
            };
            self.failures = 0;
            let now = Instant::now();
            let cur: HashMap<u32, (u64, u64)> = sockets.into_iter().map(|s| (s.inode, (s.rx, s.tx))).collect();
            let rates = match &self.prev {
                Some((t, prev)) => {
                    // Only scan /proc when an active socket has no known owner.
                    let unknown: Vec<u32> = cur
                        .iter()
                        .filter(|(inode, v)| {
                            !self.owners.contains_key(inode)
                                && !self.unowned.contains(inode)
                                && prev.get(inode).is_some_and(|p| p != *v)
                        })
                        .map(|(inode, _)| *inode)
                        .collect();
                    let may_scan = self.last_scan.is_none_or(|t| now.duration_since(t) >= MIN_SCAN_INTERVAL);
                    if !unknown.is_empty() && may_scan {
                        self.owners = scan_socket_owners();
                        self.last_scan = Some(now);
                        self.unowned.extend(unknown.into_iter().filter(|i| !self.owners.contains_key(i)));
                    }
                    let owners = &self.owners;
                    rates_from_counters(prev, &cur, now.duration_since(*t).as_secs_f64(), |inode| owners.get(&inode).copied())
                }
                None => HashMap::new(),
            };
            // Forget sockets that closed.
            self.owners.retain(|inode, _| cur.contains_key(inode));
            self.unowned.retain(|inode| cur.contains_key(inode));
            self.prev = Some((now, cur));
            rates
        }

        pub fn status(&self) -> ProcNetStatus {
            let root = unsafe { libc::geteuid() } == 0;
            let working = self.failures < 3;
            ProcNetStatus {
                available: working,
                scope: "TCP".to_string(),
                note: Some(if !working {
                    "The kernel's socket diagnostics interface (sock_diag) is unavailable.".to_string()
                } else if root {
                    "TCP traffic per process from the kernel's socket statistics; UDP (e.g. QUIC, DNS, games) isn't counted.".to_string()
                } else {
                    "TCP traffic per process from the kernel's socket statistics. Only your own processes can be attributed without root, and UDP (e.g. QUIC) isn't counted.".to_string()
                }),
            }
        }
    }

    /// Dump all IPv4 + IPv6 TCP sockets with their `tcp_info`.
    fn dump_tcp() -> Option<Vec<DiagSocket>> {
        let fd = unsafe { libc::socket(libc::AF_NETLINK, libc::SOCK_DGRAM | libc::SOCK_CLOEXEC, libc::NETLINK_SOCK_DIAG) };
        if fd < 0 {
            return None;
        }
        struct Fd(i32);
        impl Drop for Fd {
            fn drop(&mut self) {
                unsafe { libc::close(self.0) };
            }
        }
        let fd = Fd(fd);
        // Never hang the collector on a misbehaving kernel.
        let timeout = libc::timeval { tv_sec: 1, tv_usec: 0 };
        unsafe {
            libc::setsockopt(fd.0, libc::SOL_SOCKET, libc::SO_RCVTIMEO, &timeout as *const _ as *const _, std::mem::size_of::<libc::timeval>() as u32);
        }
        let mut all = Vec::new();
        for family in [AF_INET, AF_INET6] {
            all.extend(dump_family(fd.0, family)?);
        }
        Some(all)
    }

    fn dump_family(fd: i32, family: u8) -> Option<Vec<DiagSocket>> {
        const SOCK_DIAG_BY_FAMILY: u16 = 20;
        const NLM_F_REQUEST: u16 = 1;
        const NLM_F_DUMP: u16 = 0x300;
        // nlmsghdr (16) + inet_diag_req_v2 (56).
        let mut req = [0u8; 72];
        req[0..4].copy_from_slice(&72u32.to_ne_bytes());
        req[4..6].copy_from_slice(&SOCK_DIAG_BY_FAMILY.to_ne_bytes());
        req[6..8].copy_from_slice(&(NLM_F_REQUEST | NLM_F_DUMP).to_ne_bytes());
        req[8..12].copy_from_slice(&1u32.to_ne_bytes());
        req[16] = family;
        req[17] = libc::IPPROTO_TCP as u8;
        req[18] = 1 << (INET_DIAG_INFO - 1);
        // Only states that move data; LISTEN / TIME_WAIT / SYN_RECV sockets
        // (tens of thousands on a busy server) carry nothing useful.
        const TCP_ESTABLISHED: u32 = 1;
        const TCP_SYN_SENT: u32 = 2;
        const TCP_FIN_WAIT1: u32 = 4;
        const TCP_FIN_WAIT2: u32 = 5;
        const TCP_CLOSE_WAIT: u32 = 8;
        const TCP_LAST_ACK: u32 = 9;
        const TCP_CLOSING: u32 = 11;
        let states = [TCP_ESTABLISHED, TCP_SYN_SENT, TCP_FIN_WAIT1, TCP_FIN_WAIT2, TCP_CLOSE_WAIT, TCP_LAST_ACK, TCP_CLOSING]
            .iter()
            .fold(0u32, |mask, state| mask | (1 << state));
        req[20..24].copy_from_slice(&states.to_ne_bytes());

        let mut kernel: libc::sockaddr_nl = unsafe { std::mem::zeroed() };
        kernel.nl_family = libc::AF_NETLINK as u16;
        let sent = unsafe {
            libc::sendto(fd, req.as_ptr() as *const _, req.len(), 0, &kernel as *const _ as *const libc::sockaddr, std::mem::size_of::<libc::sockaddr_nl>() as u32)
        };
        if sent < 0 {
            return None;
        }
        let mut sockets = Vec::new();
        let mut buf = vec![0u8; 64 * 1024];
        loop {
            let n = unsafe { libc::recv(fd, buf.as_mut_ptr() as *mut _, buf.len(), 0) };
            if n <= 0 {
                return None;
            }
            let (batch, end) = parse_diag_dump(&buf[..n as usize]);
            sockets.extend(batch);
            match end {
                DumpEnd::More => {}
                DumpEnd::Done => return Some(sockets),
                DumpEnd::Error => return None,
            }
        }
    }

    /// Map socket inodes to PIDs. Other users' fd tables are unreadable
    /// without root, so their sockets stay unattributed.
    fn scan_socket_owners() -> HashMap<u32, u32> {
        let mut owners = HashMap::new();
        let Ok(procs) = fs::read_dir("/proc") else { return owners };
        for entry in procs.flatten() {
            let Some(pid) = entry.file_name().to_str().and_then(|s| s.parse::<u32>().ok()) else { continue };
            let Ok(fds) = fs::read_dir(entry.path().join("fd")) else { continue };
            for fd in fds.flatten() {
                if let Some(inode) = fs::read_link(fd.path()).ok().and_then(|t| t.to_str().and_then(socket_inode)) {
                    owners.entry(inode).or_insert(pid);
                }
            }
        }
        owners
    }
}

// ─── macOS: nettop ───────────────────────────────────────────────────────────

/// Parse `nettop -P -L <n> -d -x -J bytes_in,bytes_out` CSV output and
/// return the last sample's per-PID byte deltas. Rows look like
/// `12:34:56.789012,Google Chrome H.1234,5120,880,`; each sample begins with
/// a `time,,bytes_in,bytes_out,` header.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn parse_nettop(text: &str) -> HashMap<u32, (u64, u64)> {
    let mut samples: Vec<HashMap<u32, (u64, u64)>> = Vec::new();
    let mut current_time: Option<String> = None;
    let has_headers = text.lines().any(|l| l.starts_with("time,"));
    for line in text.lines() {
        let fields: Vec<&str> = line.split(',').collect();
        if fields.len() < 4 {
            continue;
        }
        if fields[0] == "time" {
            samples.push(HashMap::new());
            current_time = None;
            continue;
        }
        // Process names can contain commas; the numbers are the last fields.
        let n = fields.len();
        let (name_fields, rx, tx) = if fields[n - 1].is_empty() {
            (&fields[1..n - 3], fields[n - 3], fields[n - 2])
        } else {
            (&fields[1..n - 2], fields[n - 2], fields[n - 1])
        };
        let name = name_fields.join(",");
        let Some(pid) = name.rsplit_once('.').and_then(|(_, pid)| pid.parse::<u32>().ok()) else { continue };
        let (Ok(rx), Ok(tx)) = (rx.trim().parse::<u64>(), tx.trim().parse::<u64>()) else { continue };
        // Without headers, a new timestamp starts a new sample.
        let new_time = current_time.as_deref().is_some_and(|t| t != fields[0]);
        if samples.is_empty() || (!has_headers && new_time) {
            samples.push(HashMap::new());
        }
        current_time = Some(fields[0].to_string());
        let e = samples.last_mut().unwrap().entry(pid).or_default();
        e.0 += rx;
        e.1 += tx;
    }
    samples.pop().unwrap_or_default()
}

#[cfg(target_os = "macos")]
mod platform {
    use super::*;
    use std::process::{Command, Stdio};
    use std::sync::{Arc, Mutex};
    use std::time::{Duration, Instant};

    /// Delta-mode sampling window; nettop reports bytes over this interval.
    const WINDOW_SECS: u64 = 1;
    const PAUSE: Duration = Duration::from_secs(1);

    #[derive(Default)]
    struct Shared {
        rates: HashMap<u32, NetRate>,
        updated: Option<Instant>,
        failed: bool,
    }

    pub struct Collector {
        shared: Arc<Mutex<Shared>>,
        started: bool,
    }

    impl Collector {
        pub fn new() -> Self {
            Self { shared: Arc::default(), started: false }
        }

        pub fn sample(&mut self) -> HashMap<u32, NetRate> {
            if !self.started {
                self.started = true;
                let shared = self.shared.clone();
                std::thread::Builder::new()
                    .name("nettop".into())
                    .spawn(move || run_loop(shared))
                    .ok();
            }
            let shared = self.shared.lock().unwrap_or_else(|p| p.into_inner());
            // Stale data (nettop stuck) is worse than none.
            match shared.updated {
                Some(t) if t.elapsed() < Duration::from_secs(10) => shared.rates.clone(),
                _ => HashMap::new(),
            }
        }

        pub fn status(&self) -> ProcNetStatus {
            let failed = self.shared.lock().map(|s| s.failed).unwrap_or(false);
            ProcNetStatus {
                available: !failed,
                scope: "TCP + UDP".to_string(),
                note: Some(if failed {
                    "nettop, which provides per-process network numbers on macOS, didn't run.".to_string()
                } else {
                    "Per-process network traffic from nettop.".to_string()
                }),
            }
        }
    }

    fn run_loop(shared: Arc<Mutex<Shared>>) {
        // `-t external` leaves out loopback; fall back if this macOS lacks it.
        let mut args: Vec<&str> = vec!["-t", "external"];
        let mut failures = 0;
        loop {
            match run_nettop(&args) {
                Some(bytes) => {
                    failures = 0;
                    let rates = bytes
                        .into_iter()
                        .map(|(pid, (rx, tx))| (pid, NetRate { rx_bps: rx / WINDOW_SECS, tx_bps: tx / WINDOW_SECS }))
                        .collect();
                    let mut s = shared.lock().unwrap_or_else(|p| p.into_inner());
                    s.rates = rates;
                    s.updated = Some(Instant::now());
                    s.failed = false;
                }
                None => {
                    failures += 1;
                    // A macOS without `-t external` fails every time; a
                    // transient failure shouldn't cost us the loopback filter.
                    if failures >= 3 && !args.is_empty() {
                        args.clear();
                        failures = 0;
                    } else if failures >= 3 {
                        shared.lock().unwrap_or_else(|p| p.into_inner()).failed = true;
                        // Keep trying, slowly: nettop can fail transiently.
                        std::thread::sleep(Duration::from_secs(60));
                    }
                }
            }
            std::thread::sleep(PAUSE);
        }
    }

    /// Two delta-mode samples `WINDOW_SECS` apart; the second is the traffic
    /// in that window. nettop exits afterwards, so its output is fully flushed.
    fn run_nettop(extra: &[&str]) -> Option<HashMap<u32, (u64, u64)>> {
        let window = WINDOW_SECS.to_string();
        let output = Command::new("/usr/bin/nettop")
            .args(["-P", "-L", "2", "-d", "-x", "-n", "-s", &window, "-J", "bytes_in,bytes_out"])
            .args(extra)
            .stdin(Stdio::null())
            .stderr(Stdio::null())
            .output()
            .ok()?;
        if !output.status.success() {
            return None;
        }
        let text = String::from_utf8_lossy(&output.stdout);
        if !text.contains("bytes_in") {
            return None;
        }
        Some(parse_nettop(&text))
    }
}

// ─── Windows: ETW Microsoft-Windows-Kernel-Network ──────────────────────────

/// Kernel-Network event IDs → (is_send, is_ipv6). Payloads start with
/// `PID: u32, size: u32, daddr, saddr, …` (addresses 4 or 16 bytes).
#[cfg_attr(not(windows), allow(dead_code))]
pub fn kernel_network_event(id: u16) -> Option<(bool, bool)> {
    match id {
        10 | 42 => Some((true, false)),  // TCP / UDP send, IPv4
        11 | 43 => Some((false, false)), // TCP / UDP receive, IPv4
        26 | 58 => Some((true, true)),   // TCP / UDP send, IPv6
        27 | 59 => Some((false, true)),  // TCP / UDP receive, IPv6
        _ => None,
    }
}

/// Decode (pid, bytes, is_send) from a Kernel-Network event payload, or
/// `None` for unrelated events and loopback traffic.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn decode_kernel_network(id: u16, data: &[u8]) -> Option<(u32, u32, bool)> {
    let (send, v6) = kernel_network_event(id)?;
    let pid = u32::from_le_bytes(data.get(0..4)?.try_into().ok()?);
    let size = u32::from_le_bytes(data.get(4..8)?.try_into().ok()?);
    let loopback = if v6 {
        is_loopback_v6(data.get(8..24)?.try_into().ok()?)
    } else {
        is_loopback_v4(data.get(8..12)?.try_into().ok()?)
    };
    (!loopback).then_some((pid, size, send))
}

#[cfg(windows)]
mod platform {
    use super::*;
    use std::sync::Mutex;
    use std::time::Instant;
    use windows::core::{GUID, PWSTR};
    use windows::Win32::Foundation::{ERROR_ACCESS_DENIED, ERROR_ALREADY_EXISTS, ERROR_SUCCESS, WIN32_ERROR};
    use windows::Win32::System::Diagnostics::Etw::{
        CloseTrace, ControlTraceW, EnableTraceEx2, OpenTraceW, ProcessTrace, StartTraceW, CONTROLTRACE_HANDLE,
        EVENT_CONTROL_CODE_ENABLE_PROVIDER, EVENT_RECORD, EVENT_TRACE_CONTROL_STOP, EVENT_TRACE_LOGFILEW,
        EVENT_TRACE_PROPERTIES, EVENT_TRACE_REAL_TIME_MODE, PROCESS_TRACE_MODE_EVENT_RECORD,
        PROCESS_TRACE_MODE_REAL_TIME, WNODE_FLAG_TRACED_GUID,
    };

    const SESSION_NAME: &str = "ResourceScope-Network";
    /// Microsoft-Windows-Kernel-Network {7DD42A49-5329-4832-8DFD-43D979153A88}.
    const KERNEL_NETWORK: GUID = GUID::from_u128(0x7dd42a49_5329_4832_8dfd_43d979153a88);
    /// KERNEL_NETWORK_KEYWORD_IPV4 | _IPV6.
    const KEYWORDS: u64 = 0x10 | 0x20;

    /// Cumulative (rx, tx) bytes per PID since the session started. Written
    /// by the ETW callback thread.
    static TOTALS: Mutex<Option<HashMap<u32, (u64, u64)>>> = Mutex::new(None);
    /// Cleared when the consumer thread's ProcessTrace returns, i.e. the
    /// session was stopped (by another ResourceScope instance, or an admin).
    static CONSUMER_ALIVE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

    enum State {
        Running,
        NeedsAdmin,
        /// The session ended underneath us.
        Stopped,
        Failed(String),
    }

    pub struct Collector {
        state: State,
        prev: Option<(Instant, ByteCounters<u32>)>,
    }

    impl Collector {
        pub fn new() -> Self {
            // Unit tests (CI runs them as administrator) must not start or
            // steal a machine-wide trace session.
            if cfg!(test) {
                return Self { state: State::Failed("disabled in tests".into()), prev: None };
            }
            let state = match start_session() {
                Ok(()) => State::Running,
                Err(e) if e == ERROR_ACCESS_DENIED => State::NeedsAdmin,
                Err(e) => State::Failed(format!("{e:?}")),
            };
            Self { state, prev: None }
        }

        pub fn sample(&mut self) -> HashMap<u32, NetRate> {
            if !matches!(self.state, State::Running) {
                return HashMap::new();
            }
            if !CONSUMER_ALIVE.load(std::sync::atomic::Ordering::Acquire) {
                self.state = State::Stopped;
                return HashMap::new();
            }
            let cur = TOTALS.lock().unwrap_or_else(|p| p.into_inner()).clone().unwrap_or_default();
            let now = Instant::now();
            let rates = match &self.prev {
                Some((t, prev)) => rates_from_counters(prev, &cur, now.duration_since(*t).as_secs_f64(), Some),
                None => HashMap::new(),
            };
            self.prev = Some((now, cur));
            rates
        }

        pub fn status(&self) -> ProcNetStatus {
            match &self.state {
                State::Running => ProcNetStatus {
                    available: true,
                    scope: "TCP + UDP".to_string(),
                    note: Some("Per-process network traffic from Windows kernel network events (ETW).".to_string()),
                },
                State::NeedsAdmin => ProcNetStatus {
                    available: false,
                    scope: String::new(),
                    note: Some("Windows only reports per-process network traffic to administrators. Run ResourceScope as administrator to see it.".to_string()),
                },
                State::Stopped => ProcNetStatus {
                    available: false,
                    scope: String::new(),
                    note: Some("The Windows network event session was stopped (another ResourceScope window may have taken it over). Restart ResourceScope to see per-process network traffic again.".to_string()),
                },
                State::Failed(e) => ProcNetStatus {
                    available: false,
                    scope: String::new(),
                    note: Some(format!("Couldn't start the Windows network event session ({e}).")),
                },
            }
        }
    }

    impl Drop for Collector {
        fn drop(&mut self) {
            if matches!(self.state, State::Running) {
                shutdown();
            }
        }
    }

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    /// EVENT_TRACE_PROPERTIES followed by room for the session name, in a
    /// u64 buffer so the struct is aligned.
    fn properties_buffer() -> Vec<u64> {
        let props = std::mem::size_of::<EVENT_TRACE_PROPERTIES>();
        let total = props + (SESSION_NAME.len() + 1) * 2;
        let mut buf = vec![0u64; total.div_ceil(8)];
        let p = buf.as_mut_ptr() as *mut EVENT_TRACE_PROPERTIES;
        unsafe {
            (*p).Wnode.BufferSize = total as u32;
            (*p).Wnode.Flags = WNODE_FLAG_TRACED_GUID;
            (*p).Wnode.ClientContext = 1; // QPC timestamps
            (*p).LogFileMode = EVENT_TRACE_REAL_TIME_MODE;
            (*p).LoggerNameOffset = props as u32;
        }
        buf
    }

    /// Stop our session on exit — only if this instance is the one running
    /// it, so a second instance quitting doesn't kill the first one's.
    pub fn shutdown() {
        if CONSUMER_ALIVE.load(std::sync::atomic::Ordering::Acquire) {
            stop_session();
        }
    }

    fn stop_session() {
        let mut buf = properties_buffer();
        let name = wide(SESSION_NAME);
        unsafe {
            let _ = ControlTraceW(
                CONTROLTRACE_HANDLE::default(),
                windows::core::PCWSTR(name.as_ptr()),
                buf.as_mut_ptr() as *mut EVENT_TRACE_PROPERTIES,
                EVENT_TRACE_CONTROL_STOP,
            );
        }
    }

    fn start_session() -> Result<(), WIN32_ERROR> {
        let name = wide(SESSION_NAME);
        let mut handle = CONTROLTRACE_HANDLE::default();
        let mut buf = properties_buffer();
        let mut rc = unsafe {
            StartTraceW(&mut handle, windows::core::PCWSTR(name.as_ptr()), buf.as_mut_ptr() as *mut EVENT_TRACE_PROPERTIES)
        };
        if rc == ERROR_ALREADY_EXISTS {
            // Left behind by a previous run that didn't exit cleanly.
            stop_session();
            buf = properties_buffer();
            rc = unsafe {
                StartTraceW(&mut handle, windows::core::PCWSTR(name.as_ptr()), buf.as_mut_ptr() as *mut EVENT_TRACE_PROPERTIES)
            };
        }
        if rc != ERROR_SUCCESS {
            return Err(rc);
        }
        let rc = unsafe {
            EnableTraceEx2(handle, &KERNEL_NETWORK, EVENT_CONTROL_CODE_ENABLE_PROVIDER.0, 4, KEYWORDS, 0, 0, None)
        };
        if rc != ERROR_SUCCESS {
            stop_session();
            return Err(rc);
        }
        *TOTALS.lock().unwrap_or_else(|p| p.into_inner()) = Some(HashMap::new());

        CONSUMER_ALIVE.store(true, std::sync::atomic::Ordering::Release);
        std::thread::Builder::new()
            .name("etw-network".into())
            .spawn(move || {
                let mut name = wide(SESSION_NAME);
                let mut logfile = EVENT_TRACE_LOGFILEW { LoggerName: PWSTR(name.as_mut_ptr()), ..Default::default() };
                logfile.Anonymous1.ProcessTraceMode = PROCESS_TRACE_MODE_REAL_TIME | PROCESS_TRACE_MODE_EVENT_RECORD;
                logfile.Anonymous2.EventRecordCallback = Some(on_event);
                unsafe {
                    let trace = OpenTraceW(&mut logfile);
                    if trace.Value == u64::MAX {
                        CONSUMER_ALIVE.store(false, std::sync::atomic::Ordering::Release);
                        return;
                    }
                    // Blocks until the session stops.
                    let _ = ProcessTrace(&[trace], None, None);
                    CONSUMER_ALIVE.store(false, std::sync::atomic::Ordering::Release);
                    let _ = CloseTrace(trace);
                }
            })
            .map_err(|_| WIN32_ERROR(1))?;
        Ok(())
    }

    unsafe extern "system" fn on_event(record: *mut EVENT_RECORD) {
        let Some(record) = record.as_ref() else { return };
        if record.EventHeader.ProviderId != KERNEL_NETWORK || record.UserData.is_null() {
            return;
        }
        let data = std::slice::from_raw_parts(record.UserData as *const u8, record.UserDataLength as usize);
        let Some((pid, size, send)) = decode_kernel_network(record.EventHeader.EventDescriptor.Id, data) else { return };
        let mut totals = TOTALS.lock().unwrap_or_else(|p| p.into_inner());
        if let Some(map) = totals.as_mut() {
            let e = map.entry(pid).or_default();
            if send {
                e.1 += size as u64;
            } else {
                e.0 += size as u64;
            }
        }
    }
}

#[cfg(not(any(target_os = "linux", target_os = "macos", windows)))]
mod platform {
    use super::*;

    pub struct Collector;

    impl Collector {
        pub fn new() -> Self {
            Self
        }
        pub fn sample(&mut self) -> HashMap<u32, NetRate> {
            HashMap::new()
        }
        pub fn status(&self) -> ProcNetStatus {
            ProcNetStatus { available: false, scope: String::new(), note: None }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn diag_message(family: u8, dst: &[u8], inode: u32, acked: u64, received: u64) -> Vec<u8> {
        let mut msg = vec![0u8; 72];
        msg[0] = family;
        msg[24..24 + dst.len()].copy_from_slice(dst);
        msg[68..72].copy_from_slice(&inode.to_ne_bytes());
        let mut info = vec![0u8; 232];
        info[TCPI_BYTES_ACKED..TCPI_BYTES_ACKED + 8].copy_from_slice(&acked.to_ne_bytes());
        info[TCPI_BYTES_RECEIVED..TCPI_BYTES_RECEIVED + 8].copy_from_slice(&received.to_ne_bytes());
        // An unrelated attribute first (INET_DIAG_MEMINFO, odd length → padded).
        msg.extend_from_slice(&7u16.to_ne_bytes());
        msg.extend_from_slice(&1u16.to_ne_bytes());
        msg.extend_from_slice(&[0, 0, 0, 0]);
        msg.extend_from_slice(&((info.len() + 4) as u16).to_ne_bytes());
        msg.extend_from_slice(&INET_DIAG_INFO.to_ne_bytes());
        msg.extend_from_slice(&info);
        let mut out = Vec::new();
        out.extend_from_slice(&((msg.len() + 16) as u32).to_ne_bytes());
        out.extend_from_slice(&20u16.to_ne_bytes());
        out.extend_from_slice(&[0u8; 10]);
        out.extend_from_slice(&msg);
        out
    }

    #[test]
    fn parses_sock_diag_dump() {
        let mut buf = diag_message(AF_INET, &[93, 184, 216, 34], 1001, 500, 9000);
        buf.extend(diag_message(AF_INET, &[127, 0, 0, 1], 1002, 5, 5)); // loopback
        buf.extend(diag_message(AF_INET6, &std::net::Ipv6Addr::LOCALHOST.octets(), 1003, 5, 5)); // loopback
        buf.extend(diag_message(AF_INET6, &"2606:4700::1".parse::<std::net::Ipv6Addr>().unwrap().octets(), 1004, 1, 2));
        buf.extend(diag_message(AF_INET, &[1, 1, 1, 1], 0, 1, 1)); // TIME_WAIT: no inode
        let (sockets, end) = parse_diag_dump(&buf);
        assert_eq!(end, DumpEnd::More);
        assert_eq!(sockets, vec![DiagSocket { inode: 1001, rx: 9000, tx: 500 }, DiagSocket { inode: 1004, rx: 2, tx: 1 }]);

        let mut done_msg = vec![0u8; 20];
        done_msg[0..4].copy_from_slice(&20u32.to_ne_bytes());
        done_msg[4..6].copy_from_slice(&NLMSG_DONE.to_ne_bytes());
        assert_eq!(parse_diag_dump(&done_msg).1, DumpEnd::Done);
        done_msg[4..6].copy_from_slice(&NLMSG_ERROR.to_ne_bytes());
        assert_eq!(parse_diag_dump(&done_msg).1, DumpEnd::Error);
    }

    #[test]
    fn socket_links() {
        assert_eq!(socket_inode("socket:[123456]"), Some(123456));
        assert_eq!(socket_inode("pipe:[1]"), None);
        assert_eq!(socket_inode("/dev/null"), None);
    }

    #[test]
    fn counters_become_per_pid_rates() {
        let prev: HashMap<u32, (u64, u64)> = [(1, (1000, 100)), (2, (0, 0)), (3, (50, 50)), (9, (10, 10))].into();
        let cur: HashMap<u32, (u64, u64)> = [(1, (3000, 300)), (2, (1000, 0)), (3, (50, 50)), (4, (99, 99)), (9, (0, 0))].into();
        // Sockets 1 and 2 belong to PID 100; 3 is idle; 4 is new; 9 went backwards.
        let owner = |k: u32| match k {
            1 | 2 => Some(100),
            _ => Some(200),
        };
        let rates = rates_from_counters(&prev, &cur, 2.0, owner);
        assert_eq!(rates.len(), 1);
        assert_eq!(rates[&100], NetRate { rx_bps: 1500, tx_bps: 100 });
    }

    #[test]
    fn parses_nettop_csv() {
        let text = "time,,bytes_in,bytes_out,\n\
                    10:00:00.000001,launchd.1,100,100,\n\
                    10:00:00.000001,Google Chrome H.812,9999,9999,\n\
                    time,,bytes_in,bytes_out,\n\
                    10:00:01.000001,launchd.1,0,0,\n\
                    10:00:01.000001,Google Chrome H.812,20480,1024,\n\
                    10:00:01.000001,Weird, Name.77,5,6,\n\
                    10:00:01.000001,noprocid,5,6,\n";
        let got = parse_nettop(text);
        assert_eq!(got.get(&812), Some(&(20480, 1024)));
        assert_eq!(got.get(&77), Some(&(5, 6)));
        assert_eq!(got.get(&1), Some(&(0, 0)));
        assert_eq!(got.len(), 3);
        assert!(parse_nettop("").is_empty());
    }

    #[test]
    fn decodes_kernel_network_events() {
        let mut v4 = Vec::new();
        v4.extend_from_slice(&4321u32.to_le_bytes());
        v4.extend_from_slice(&1500u32.to_le_bytes());
        v4.extend_from_slice(&[8, 8, 8, 8, 192, 168, 1, 2]);
        assert_eq!(decode_kernel_network(10, &v4), Some((4321, 1500, true)));
        assert_eq!(decode_kernel_network(43, &v4), Some((4321, 1500, false)));
        assert_eq!(decode_kernel_network(12, &v4), None); // TCP connect: not traffic
        let mut lo = v4.clone();
        lo[8..12].copy_from_slice(&[127, 0, 0, 1]);
        assert_eq!(decode_kernel_network(11, &lo), None);
        assert_eq!(decode_kernel_network(10, &v4[..6]), None);

        let mut v6 = Vec::new();
        v6.extend_from_slice(&7u32.to_le_bytes());
        v6.extend_from_slice(&64u32.to_le_bytes());
        v6.extend_from_slice(&std::net::Ipv6Addr::LOCALHOST.octets());
        assert_eq!(decode_kernel_network(27, &v6), None);
        v6[8..24].copy_from_slice(&"2001:db8::1".parse::<std::net::Ipv6Addr>().unwrap().octets());
        assert_eq!(decode_kernel_network(27, &v6), Some((7, 64, false)));
    }
}
