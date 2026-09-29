# ResourceScope 📊

> A clean, low-overhead system resource monitor for macOS, Windows, and Linux.

Built with **Tauri v2**, a **Rust** backend, and a **React/TypeScript** frontend. Ships as a native app (~10 MB) with no Electron, no browser chrome — just a fast, real-time dashboard.

![ResourceScope screenshot](https://i.imgur.com/xyBOoqg.png)

---

## Features

- **Live CPU** — overall load, per-core breakdown, frequency, model name, load average
- **Memory** — used / available / total, swap
- **GPU** — every GPU in the system: utilization, VRAM, temperature and clock where the OS or vendor tools expose them (macOS IORegistry/powermetrics, Windows perf counters, Linux sysfs, `nvidia-smi`)
- **Disk** — volumes with usage, live read/write rates, and a storage examiner that finds what's using space
- **Network** — per-interface rates and totals, plus per-process traffic (Linux: TCP; macOS: nettop; Windows: when run as administrator)
- **Processes** — every process, grouped by app (Chrome, Electron, …) or flat; CPU, memory, disk I/O, owner, command line; end a process or a whole app
- **Battery** — charge, time remaining, health, cycle count and power draw on laptops
- **History** — 30 days of metrics (10-second detail for 24 hours) with charts, a table view and CSV export; optional continuous CSV logging
- **Alerts** — desktop notifications when CPU/memory stay high, a disk fills up, a CPU/GPU runs hot, or the battery runs low (works while hidden in the tray)
- **Tray / menu bar** — live stats, hide-to-tray, launch at login (starts hidden)
- **Light & dark themes** — System / Dark / Light
- **Updates** — checks GitHub for new versions; one-click install once signing is set up ([docs/auto-updates.md](docs/auto-updates.md))

---

## Tech Stack

| Layer | Tech |
|-------|------|
| Frontend | React 19 + TypeScript + Vite 7 |
| Styling | Tailwind CSS v4 (dark + light themes via CSS tokens) |
| State | Zustand with selector subscriptions |
| Backend | Rust via Tauri v2 |
| Metrics | [`sysinfo`](https://github.com/GuillaumeGomez/sysinfo) crate |
| Charts | Recharts (History tab, lazy-loaded) |
| Tests | `cargo test` + Vitest, run in CI on macOS, Windows and Linux |

---

## Getting Started

### Prerequisites

- [Rust](https://rustup.rs/) (stable)
- [Node.js](https://nodejs.org/) 22.12+
- Tauri prerequisites for your OS → [Tauri v2 prerequisites guide](https://tauri.app/start/prerequisites/)

### Development

```bash
git clone https://github.com/Cosm00/resourcescope.git
cd resourcescope
npm install
npm run tauri dev        # Starts Vite + Rust backend with hot-reload
```

### Production build

```bash
npm run tauri build      # Produces .dmg / .exe / .AppImage in src-tauri/target/release/bundle/
```

---

## Architecture

```
Frontend (React + TypeScript + Vite)
  └─ Zustand store with ring-buffer histories
  └─ Selector subscriptions (only re-renders changed slices)
  └─ Sparklines, GaugeRings, CoreGrid, ProcessTable
  └─ Tailwind CSS v4 dark theme

Rust Backend (Tauri v2 + sysinfo + tokio)
  └─ sysinfo crate: CPU, RAM, disk, network, processes, temperatures
  └─ tokio async runtime
  └─ Dedicated collector thread emits "metrics_update" every 1 500 ms (configurable)
  └─ One-shot "get_metrics" command for initial load
```

**Performance notes:**
- Ring buffers for history — O(1) append, no array copies
- Two tick rates: fast scalars (1 500 ms), slow histories (every 3rd tick ≈ 4.5 s)
- Process list capped at top 80 by CPU
- CSS transitions for gauge/sparkline animation — GPU composited

---

## Roadmap

- [x] Individual drill-down panels (CPU / Memory / GPU / Disk / Network / Processes / History)
- [x] Windows: DXGI / perf-counter GPU collector
- [x] NVIDIA telemetry via `nvidia-smi` (Linux + Windows); multi-GPU
- [x] Alert thresholds with native system notifications
- [x] Settings panel (refresh interval, thresholds, units, theme, tray behaviour)
- [x] System tray with mini stats; launch at login
- [x] History, export / CSV logging
- [x] GPU: AMD/Intel temperatures on Windows (driver-reported via D3DKMT), Intel utilization on Linux (i915 PMU / DRM fdinfo)
- [x] macOS: multi-GPU (Intel Macs) and per-core temps (Apple silicon sensors, Intel-Mac SMC — no root needed)
- [x] Per-process network usage

---


## GPU telemetry status

ResourceScope now uses a backend-based GPU collector instead of pretending every OS exposes the same telemetry.

Current state:
- **macOS:** every IOAccelerator (multi-GPU Intel Macs and eGPUs included) with identity from `system_profiler`; utilization, memory, and on AMD temperature/clock from `PerformanceStatistics`; optionally an elevated `powermetrics` helper for GPU active residency
- **Windows:** DXGI adapter discovery plus the `GPU Engine` / `GPU Adapter Memory` perf counters for live utilization and dedicated VRAM, and driver-reported temperature via `D3DKMTQueryAdapterInfo` for AMD/Intel/NVIDIA (all match Task Manager); NVIDIA cards add clock via `nvidia-smi`
- **Linux:** `/sys/class/drm` + `hwmon` (AMD: utilization, VRAM, clock, temperature; Intel: utilization via the i915 PMU or DRM fdinfo, clock, temperature); NVIDIA via `nvidia-smi` from the proprietary driver

Possible next layers:
- **Windows vendor SDKs** (ADL / IGCL / NVML) for fan speed, power and hotspot temperatures
- **Linux:** the xe PMU for system-wide Intel utilization without relying on fdinfo

What this means in practice:
- the app now reports the active GPU backend and support level directly in the UI
- some machines will show **full** metrics, some **partial**, and some **unsupported** depending on driver/OS exposure
- this is intentional: honest telemetry beats fake precision

### macOS elevated GPU helper

For fuller macOS GPU telemetry, ResourceScope can use an elevated helper command instead of calling `powermetrics` directly from the main app process.

Included helper scaffolds:
- `scripts/macos/resourcescope-gpu-helper.sh`
- `scripts/macos/resourcescope-gpu-helper-json.sh`

Suggested install path:
- `/usr/local/bin/resourcescope-gpu-helper`

Backend behavior:
- if `RESOURCESCOPE_GPU_HELPER_JSON` is set, ResourceScope tries that JSON helper first
- otherwise it looks for `/usr/local/bin/resourcescope-gpu-helper-json`
- then it falls back to `RESOURCESCOPE_GPU_HELPER`
- then `/usr/local/bin/resourcescope-gpu-helper`
- if no helper exists, it falls back to direct `powermetrics` and then to non-elevated sources

This keeps the main app usable without admin while allowing fuller telemetry when a deliberate elevated helper is installed.

## Support

If you find ResourceScope useful, you can support development here:

- **GitHub Sponsors:** https://github.com/sponsors/Cosm00
- **Ko-fi:** https://ko-fi.com/cosm00

## Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

---

## License

MIT — see [LICENSE](LICENSE) for details.
