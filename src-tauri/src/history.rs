//! Long-term metric history.
//!
//! Every tick is folded into two downsampled tiers:
//! - **fine**: 10-second buckets, kept for 24 hours (≤ 8,640 points)
//! - **coarse**: 5-minute buckets, kept for 30 days (≤ 8,640 points)
//!
//! Both tiers persist to a small binary file in the app data directory so
//! charts survive restarts, and finished fine buckets can optionally be
//! appended to a daily CSV log.

use serde::Serialize;
use std::collections::VecDeque;
use std::fs::{self, File, OpenOptions};
use std::io::{BufReader, BufWriter, Read, Write};
use std::path::{Path, PathBuf};

use crate::metrics::MetricsSnapshot;

const FINE_BUCKET_MS: u64 = 10_000;
const FINE_RETENTION_MS: u64 = 24 * 3600 * 1000;
const COARSE_BUCKET_MS: u64 = 5 * 60_000;
const COARSE_RETENTION_MS: u64 = 30 * 24 * 3600 * 1000;
/// Charts don't need more points than they have pixels.
const MAX_QUERY_POINTS: usize = 720;

const FILE_MAGIC: &[u8; 4] = b"RSH1";

/// Metric columns, in storage order. `NaN` means "not available".
pub const COLUMNS: [&str; 10] = [
    "cpu_pct",
    "cpu_max_pct",
    "mem_pct",
    "gpu_pct",
    "net_recv_bps",
    "net_sent_bps",
    "disk_read_bps",
    "disk_write_bps",
    "cpu_temp_c",
    "battery_pct",
];
const N: usize = COLUMNS.len();
const CPU_MAX: usize = 1;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Sample {
    pub ts: u64,
    pub values: [f32; N],
}

impl Sample {
    pub fn from_snapshot(s: &MetricsSnapshot) -> Self {
        let opt = |v: Option<f32>| v.unwrap_or(f32::NAN);
        let net_rx: u64 = s.networks.iter().map(|n| n.recv_bps).sum();
        let net_tx: u64 = s.networks.iter().map(|n| n.sent_bps).sum();
        let disk_r: u64 = s.disks.iter().map(|d| d.read_bps).sum();
        let disk_w: u64 = s.disks.iter().map(|d| d.write_bps).sum();
        Self {
            ts: s.timestamp,
            values: [
                s.cpu.usage_pct,
                s.cpu.usage_pct,
                s.memory.usage_pct,
                opt(s.gpu.as_ref().and_then(|g| g.utilization_pct)),
                net_rx as f32,
                net_tx as f32,
                disk_r as f32,
                disk_w as f32,
                opt(s.health.cpu_temp),
                opt(s.batteries.first().map(|b| b.charge_pct)),
            ],
        }
    }
}

/// Running average of samples in one bucket (NaN-aware; column 1 is a max).
#[derive(Clone, Debug)]
struct Accumulator {
    bucket_start: u64,
    sums: [f64; N],
    counts: [u32; N],
    cpu_max: f32,
}

impl Accumulator {
    fn new(bucket_start: u64) -> Self {
        Self { bucket_start, sums: [0.0; N], counts: [0; N], cpu_max: f32::NAN }
    }

    fn add(&mut self, s: &Sample) {
        for (i, v) in s.values.iter().enumerate() {
            if i == CPU_MAX {
                if v.is_finite() {
                    self.cpu_max = if self.cpu_max.is_finite() { self.cpu_max.max(*v) } else { *v };
                }
            } else if v.is_finite() {
                self.sums[i] += *v as f64;
                self.counts[i] += 1;
            }
        }
    }

    fn is_empty(&self) -> bool {
        self.counts.iter().all(|c| *c == 0) && !self.cpu_max.is_finite()
    }

    fn finish(&self) -> Sample {
        let mut values = [f32::NAN; N];
        for (i, v) in values.iter_mut().enumerate() {
            if i == CPU_MAX {
                *v = self.cpu_max;
            } else if self.counts[i] > 0 {
                *v = (self.sums[i] / self.counts[i] as f64) as f32;
            }
        }
        Sample { ts: self.bucket_start, values }
    }
}

struct Tier {
    bucket_ms: u64,
    retention_ms: u64,
    points: VecDeque<Sample>,
    current: Option<Accumulator>,
}

impl Tier {
    fn new(bucket_ms: u64, retention_ms: u64) -> Self {
        Self { bucket_ms, retention_ms, points: VecDeque::new(), current: None }
    }

    /// Adds a sample; returns the bucket it closed, if any.
    fn add(&mut self, s: &Sample) -> Option<Sample> {
        let start = s.ts - s.ts % self.bucket_ms;
        let mut closed = None;
        match &mut self.current {
            Some(acc) if acc.bucket_start == start => acc.add(s),
            // Clock went backwards (NTP step, manual change): start over.
            Some(acc) if start < acc.bucket_start => {
                *acc = Accumulator::new(start);
                acc.add(s);
            }
            _ => {
                if let Some(acc) = self.current.take() {
                    if !acc.is_empty() {
                        let done = acc.finish();
                        self.points.push_back(done);
                        closed = Some(done);
                    }
                }
                let mut acc = Accumulator::new(start);
                acc.add(s);
                self.current = Some(acc);
            }
        }
        let cutoff = s.ts.saturating_sub(self.retention_ms);
        while self.points.front().is_some_and(|p| p.ts < cutoff) {
            self.points.pop_front();
        }
        closed
    }

    /// Stored points plus the in-progress bucket.
    fn iter_with_current(&self) -> impl Iterator<Item = Sample> + '_ {
        self.points
            .iter()
            .copied()
            .chain(self.current.as_ref().filter(|a| !a.is_empty()).map(|a| a.finish()))
    }
}

/// One point as sent to the UI; `None` where a metric wasn't available (or
/// the app wasn't running, for gap markers).
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct HistoryPoint {
    pub ts: u64,
    pub cpu_pct: Option<f32>,
    pub cpu_max_pct: Option<f32>,
    pub mem_pct: Option<f32>,
    pub gpu_pct: Option<f32>,
    pub net_recv_bps: Option<f32>,
    pub net_sent_bps: Option<f32>,
    pub disk_read_bps: Option<f32>,
    pub disk_write_bps: Option<f32>,
    pub cpu_temp_c: Option<f32>,
    pub battery_pct: Option<f32>,
}

impl From<Sample> for HistoryPoint {
    fn from(s: Sample) -> Self {
        let v = |i: usize| Some(s.values[i]).filter(|x| x.is_finite());
        Self {
            ts: s.ts,
            cpu_pct: v(0),
            cpu_max_pct: v(1),
            mem_pct: v(2),
            gpu_pct: v(3),
            net_recv_bps: v(4),
            net_sent_bps: v(5),
            disk_read_bps: v(6),
            disk_write_bps: v(7),
            cpu_temp_c: v(8),
            battery_pct: v(9),
        }
    }
}

fn gap_marker(ts: u64) -> Sample {
    Sample { ts, values: [f32::NAN; N] }
}

pub struct History {
    fine: Tier,
    coarse: Tier,
    path: Option<PathBuf>,
    log_dir: Option<PathBuf>,
    pub csv_logging: bool,
    dirty: bool,
}

impl History {
    pub fn new(path: Option<PathBuf>, log_dir: Option<PathBuf>) -> Self {
        let mut h = Self {
            fine: Tier::new(FINE_BUCKET_MS, FINE_RETENTION_MS),
            coarse: Tier::new(COARSE_BUCKET_MS, COARSE_RETENTION_MS),
            path,
            log_dir,
            csv_logging: false,
            dirty: false,
        };
        if let Some(p) = h.path.clone() {
            if let Err(e) = h.load(&p) {
                if p.exists() {
                    eprintln!("history: could not load {}: {e}", p.display());
                }
            }
        }
        h
    }

    pub fn ingest(&mut self, snapshot: &MetricsSnapshot) {
        self.ingest_sample(Sample::from_snapshot(snapshot));
    }

    pub fn ingest_sample(&mut self, s: Sample) {
        if let Some(done) = self.fine.add(&s) {
            self.coarse.add(&done);
            if self.csv_logging {
                if let Err(e) = self.append_csv_log(&done) {
                    eprintln!("history: CSV log write failed: {e}");
                }
            }
        }
        self.dirty = true;
    }

    /// Points covering the last `range_ms` up to `now_ms`, downsampled for
    /// charting, with gap markers where the app wasn't running.
    pub fn query(&self, range_ms: u64, now_ms: u64) -> Vec<HistoryPoint> {
        let tier = if range_ms <= FINE_RETENTION_MS { &self.fine } else { &self.coarse };
        let from = now_ms.saturating_sub(range_ms);
        let points: Vec<Sample> = tier.iter_with_current().filter(|p| p.ts >= from).collect();
        let merged = downsample(&points, MAX_QUERY_POINTS);
        let step = (range_ms / MAX_QUERY_POINTS as u64).max(tier.bucket_ms);
        with_gaps(&merged, step * 3).into_iter().map(HistoryPoint::from).collect()
    }

    /// Full-resolution samples for export (fine tier when it covers the range).
    pub fn export_samples(&self, range_ms: u64, now_ms: u64) -> Vec<Sample> {
        let tier = if range_ms <= FINE_RETENTION_MS { &self.fine } else { &self.coarse };
        let from = now_ms.saturating_sub(range_ms);
        tier.iter_with_current().filter(|p| p.ts >= from).collect()
    }

    // ── Persistence ─────────────────────────────────────────────────────────

    pub fn save_if_dirty(&mut self) {
        if !self.dirty {
            return;
        }
        if let Some(p) = self.path.clone() {
            match self.save(&p) {
                Ok(()) => self.dirty = false,
                Err(e) => eprintln!("history: could not save {}: {e}", p.display()),
            }
        }
    }

    fn save(&self, path: &Path) -> std::io::Result<()> {
        if let Some(dir) = path.parent() {
            fs::create_dir_all(dir)?;
        }
        // Write-then-rename so a crash mid-write never corrupts the file.
        let tmp = path.with_extension("tmp");
        {
            let mut w = BufWriter::new(File::create(&tmp)?);
            w.write_all(FILE_MAGIC)?;
            for tier in [&self.fine, &self.coarse] {
                let pts: Vec<Sample> = tier.iter_with_current().collect();
                w.write_all(&(pts.len() as u32).to_le_bytes())?;
                for p in pts {
                    w.write_all(&p.ts.to_le_bytes())?;
                    for v in p.values {
                        w.write_all(&v.to_le_bytes())?;
                    }
                }
            }
            w.flush()?;
        }
        fs::rename(&tmp, path)
    }

    fn load(&mut self, path: &Path) -> std::io::Result<()> {
        let mut r = BufReader::new(File::open(path)?);
        let mut magic = [0u8; 4];
        r.read_exact(&mut magic)?;
        if &magic != FILE_MAGIC {
            return Err(std::io::Error::new(std::io::ErrorKind::InvalidData, "unknown history format"));
        }
        let now = crate::metrics::now_ms();
        for tier in [&mut self.fine, &mut self.coarse] {
            let mut len = [0u8; 4];
            r.read_exact(&mut len)?;
            let len = u32::from_le_bytes(len) as usize;
            if len > 1_000_000 {
                return Err(std::io::Error::new(std::io::ErrorKind::InvalidData, "history file too large"));
            }
            let cutoff = now.saturating_sub(tier.retention_ms);
            for _ in 0..len {
                let mut ts = [0u8; 8];
                r.read_exact(&mut ts)?;
                let mut values = [0f32; N];
                for v in values.iter_mut() {
                    let mut b = [0u8; 4];
                    r.read_exact(&mut b)?;
                    *v = f32::from_le_bytes(b);
                }
                let ts = u64::from_le_bytes(ts);
                if ts >= cutoff && ts <= now {
                    tier.points.push_back(Sample { ts, values });
                }
            }
        }
        Ok(())
    }

    // ── CSV ─────────────────────────────────────────────────────────────────

    pub fn log_dir(&self) -> Option<&Path> {
        self.log_dir.as_deref()
    }

    fn append_csv_log(&self, s: &Sample) -> std::io::Result<()> {
        let Some(dir) = &self.log_dir else { return Ok(()) };
        fs::create_dir_all(dir)?;
        let path = dir.join(format!("metrics-{}.csv", &iso8601_utc(s.ts)[..10]));
        let new = !path.exists();
        let mut f = OpenOptions::new().create(true).append(true).open(&path)?;
        if new {
            writeln!(f, "{}", csv_header())?;
        }
        writeln!(f, "{}", csv_row(s))
    }
}

pub fn csv_header() -> String {
    format!("timestamp_utc,{}", COLUMNS.join(","))
}

pub fn csv_row(s: &Sample) -> String {
    let mut row = iso8601_utc(s.ts);
    for v in s.values {
        row.push(',');
        if v.is_finite() {
            row.push_str(&format!("{v:.2}"));
        }
    }
    row
}

pub fn write_csv(path: &Path, samples: &[Sample]) -> std::io::Result<()> {
    let mut w = BufWriter::new(File::create(path)?);
    writeln!(w, "{}", csv_header())?;
    for s in samples {
        writeln!(w, "{}", csv_row(s))?;
    }
    w.flush()
}

/// `YYYY-MM-DDTHH:MM:SSZ` without a date/time dependency
/// (Howard Hinnant's days-to-civil algorithm).
pub fn iso8601_utc(ms: u64) -> String {
    let secs = ms / 1000;
    let days = (secs / 86_400) as i64;
    let rem = secs % 86_400;
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + if m <= 2 { 1 } else { 0 };
    format!("{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z", rem / 3600, (rem % 3600) / 60, rem % 60)
}

/// Average consecutive groups so at most `max` points remain (CPU max keeps
/// the max). Timestamps are the first of each group.
fn downsample(points: &[Sample], max: usize) -> Vec<Sample> {
    if points.len() <= max || max == 0 {
        return points.to_vec();
    }
    let group = points.len().div_ceil(max);
    points
        .chunks(group)
        .map(|chunk| {
            let mut acc = Accumulator::new(chunk[0].ts);
            for p in chunk {
                acc.add(p);
                // `add` treats column 1 as a max of per-sample values, which is
                // exactly the max-of-maxes we want here.
            }
            acc.finish()
        })
        .collect()
}

/// Insert an all-empty marker after any gap wider than `max_gap_ms`, so charts
/// break the line where ResourceScope wasn't running instead of bridging it.
fn with_gaps(points: &[Sample], max_gap_ms: u64) -> Vec<Sample> {
    let mut out = Vec::with_capacity(points.len() + 8);
    for (i, p) in points.iter().enumerate() {
        if i > 0 {
            let prev = points[i - 1].ts;
            if p.ts.saturating_sub(prev) > max_gap_ms {
                out.push(gap_marker(prev + 1));
            }
        }
        out.push(*p);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(ts: u64, cpu: f32) -> Sample {
        let mut values = [f32::NAN; N];
        values[0] = cpu;
        values[1] = cpu;
        values[2] = 50.0;
        Sample { ts, values }
    }

    #[test]
    fn buckets_average_and_track_max() {
        let mut h = History::new(None, None);
        let base = 1_700_000_000_000u64 - 1_700_000_000_000 % FINE_BUCKET_MS;
        h.ingest_sample(sample(base, 10.0));
        h.ingest_sample(sample(base + 1_500, 30.0));
        h.ingest_sample(sample(base + FINE_BUCKET_MS, 50.0)); // closes first bucket
        let pts = h.query(3_600_000, base + FINE_BUCKET_MS + 1);
        assert_eq!(pts[0].cpu_pct, Some(20.0));
        assert_eq!(pts[0].cpu_max_pct, Some(30.0));
        assert_eq!(pts[0].gpu_pct, None);
        // In-progress bucket is included.
        assert_eq!(pts.last().unwrap().cpu_pct, Some(50.0));
    }

    #[test]
    fn gaps_are_marked() {
        let mut h = History::new(None, None);
        let base = 1_700_000_000_000u64;
        for i in 0..5 {
            h.ingest_sample(sample(base + i * FINE_BUCKET_MS, 10.0));
        }
        // App "closed" for an hour.
        for i in 0..5 {
            h.ingest_sample(sample(base + 3_600_000 + i * FINE_BUCKET_MS, 10.0));
        }
        let pts = h.query(2 * 3_600_000, base + 3_700_000);
        assert!(pts.iter().any(|p| p.cpu_pct.is_none()), "expected a gap marker");
    }

    #[test]
    fn downsampling_caps_points() {
        let pts: Vec<Sample> = (0..5000).map(|i| sample(i * 1000, (i % 100) as f32)).collect();
        let d = downsample(&pts, 700);
        assert!(d.len() <= 700);
        // First group is samples 0..=7 (5000 / 700 rounded up): max-of-max is 7.
        assert_eq!(d[0].values[CPU_MAX], 7.0);
        assert!((d[0].values[0] - 3.5).abs() < 1e-4);
    }

    #[test]
    fn coarse_tier_serves_long_ranges() {
        let mut h = History::new(None, None);
        let base = 1_700_000_000_000u64;
        // 3 days of one sample per minute.
        for i in 0..(3 * 24 * 60) {
            h.ingest_sample(sample(base + i * 60_000, 25.0));
        }
        let now = base + 3 * 24 * 3_600_000;
        let week = h.query(7 * 24 * 3_600_000, now);
        // 864 five-minute buckets, averaged in pairs to stay under the cap.
        assert!(week.len() > 400 && week.len() <= MAX_QUERY_POINTS + 16, "{}", week.len());
        assert!(week.iter().filter_map(|p| p.cpu_pct).all(|v| (v - 25.0).abs() < 0.01));
    }

    #[test]
    fn persistence_round_trip() {
        let dir = std::env::temp_dir().join(format!("resourcescope-hist-{}", std::process::id()));
        let path = dir.join("history.bin");
        let now = crate::metrics::now_ms();
        {
            let mut h = History::new(Some(path.clone()), None);
            for i in 0..20 {
                h.ingest_sample(sample(now - 200_000 + i * 10_000, i as f32));
            }
            h.save_if_dirty();
        }
        let h2 = History::new(Some(path.clone()), None);
        let pts = h2.query(3_600_000, now);
        fs::remove_dir_all(&dir).ok();
        assert!(pts.len() >= 19, "{}", pts.len());
    }

    #[test]
    fn corrupt_file_is_ignored() {
        let dir = std::env::temp_dir().join(format!("resourcescope-hist-bad-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("history.bin");
        fs::write(&path, b"garbage").unwrap();
        let h = History::new(Some(path), None);
        fs::remove_dir_all(&dir).ok();
        assert!(h.query(3_600_000, crate::metrics::now_ms()).is_empty());
    }

    #[test]
    fn csv_logging_appends_to_daily_file() {
        let dir = std::env::temp_dir().join(format!("resourcescope-logs-{}", std::process::id()));
        let mut h = History::new(None, Some(dir.clone()));
        h.csv_logging = true;
        let base = 1_790_000_000_000u64; // 2026-09-21
        for i in 0..4 {
            h.ingest_sample(sample(base + i * FINE_BUCKET_MS, 10.0));
        }
        let text = fs::read_to_string(dir.join("metrics-2026-09-21.csv")).unwrap();
        fs::remove_dir_all(&dir).ok();
        let lines: Vec<&str> = text.lines().collect();
        assert_eq!(lines[0], csv_header());
        // Three buckets closed (the fourth is still in progress).
        assert_eq!(lines.len(), 4);
    }

    #[test]
    fn iso_dates() {
        assert_eq!(iso8601_utc(0), "1970-01-01T00:00:00Z");
        assert_eq!(iso8601_utc(951_782_400_000), "2000-02-29T00:00:00Z");
        assert_eq!(iso8601_utc(1_790_000_000_000), "2026-09-21T14:13:20Z");
    }

    #[test]
    fn csv_rows_leave_missing_values_blank() {
        let row = csv_row(&sample(0, 12.345));
        assert_eq!(row, "1970-01-01T00:00:00Z,12.35,12.35,50.00,,,,,,,");
        assert_eq!(csv_header().split(',').count(), row.split(',').count());
    }
}
