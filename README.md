# ResourceScope 📊

> A clean, low-overhead system resource monitor for macOS, Windows, and Linux.

Built with **Tauri v2**, a **Rust** backend, and a **React/TypeScript** frontend. Ships as a native app (~10 MB) with no Electron, no browser chrome — just a fast, real-time dashboard.

![ResourceScope screenshot](https://i.imgur.com/xyBOoqg.png)

---

## Features

- **Live CPU** — overall load, per-core breakdown, frequency, model name, load average
- **Memory** — used / available / total, swap
- **Disk** — all mount points, usage %, filesystem type
- **Network** — per-interface bytes in/out, computed bps rates
- **Processes** — top 50 by CPU with memory usage
- **Temperatures** — sensor readings where the OS exposes them
- **Health panel** — derived status badges (OK / Warning / Critical) from live data
- **Sparklines & gauges** — smooth GPU-composited animations, ring-buffer history

---

## Tech Stack

| Layer | Tech |
|-------|------|
| Frontend | React 19 + TypeScript + Vite 7 |
| Styling | Tailwind CSS v4 (dark theme) |
| State | Zustand with selector subscriptions |
| Backend | Rust via Tauri v2 |
| Metrics | [`sysinfo`](https://github.com/GuillaumeGomez/sysinfo) crate |
| Runtime | Tokio async, 1 500 ms poll loop |

---

## Getting Started

### Prerequisites

- [Rust](https://rustup.rs/) (stable)
- [Node.js](https://nodejs.org/) 18+
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
  └─ Background loop emits "metrics_update" every 1 500 ms
  └─ One-shot "get_metrics" command for initial load
```

**Performance notes:**
- Ring buffers for history — O(1) append, no array copies
- Two tick rates: fast scalars (1 500 ms), slow histories (every 3rd tick ≈ 4.5 s)
- Process list capped at top 50 by CPU
- CSS transitions for gauge/sparkline animation — GPU composited

---

## Roadmap

- [ ] Individual drill-down panels (CPU / Memory / Disk / Network / Processes)
- [ ] GPU metrics phase 2 — vendor-enhanced backends (NVML for NVIDIA, DXGI/ADL on Windows, richer Intel/AMD Linux collectors)
- [ ] macOS: `powermetrics` integration for accurate per-core temps
- [ ] Windows: DXGI / perf-counter collector to replace current placeholder backend
- [ ] Alert thresholds with native system notifications
- [ ] Settings panel (refresh interval, history length, thresholds)
- [ ] System tray with mini stats
- [ ] Export / CSV logging

---


## GPU telemetry status

ResourceScope now uses a backend-based GPU collector instead of pretending every OS exposes the same telemetry.

Current state:
- **macOS:** best support right now; dynamically discovers IORegistry GPU nodes and reads Apple Silicon-style performance statistics when present
- **Linux:** partial support via `/sys/class/drm` + `hwmon` when drivers expose data
- **Windows:** scaffolded placeholder backend today; intended next step is DXGI adapter enumeration plus GPU Engine perf counters / vendor-enhanced collection

Recommended next backend layers:
- **Windows generic:** DXGI adapter name + memory, PerfLib/PDH `GPU Engine(*)\\Utilization Percentage`
- **Windows vendor-enhanced:** NVML (NVIDIA), ADL (AMD), Intel-specific telemetry when practical
- **Linux vendor-enhanced:** NVML for NVIDIA, deeper AMD/Intel driver-specific collectors
- **macOS phase 2:** broaden Intel Mac fallback and multi-GPU discovery

What this means in practice:
- the app now reports the active GPU backend and support level directly in the UI
- some machines will show **full** metrics, some **partial**, and some **unsupported** depending on driver/OS exposure
- this is intentional: honest telemetry beats fake precision

## Support

If you find ResourceScope useful, you can support development here:

- **GitHub Sponsors:** https://github.com/sponsors/Cosm00
- **Ko-fi:** https://ko-fi.com/cosm00

## Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

---

## License

MIT — see [LICENSE](LICENSE) for details.
