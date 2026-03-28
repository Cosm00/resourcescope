# ResourceScope 📊

A unified, low-overhead system resource monitor for macOS, Windows, and Linux.

**Tauri v2 + Rust backend + React/TypeScript frontend**

## Architecture

```
Frontend (React + TypeScript + Vite)
  - Zustand store with ring-buffer histories
  - Selector-based subscriptions (only re-renders changed slices)
  - Sparklines, GaugeRings, CoreGrid, ProcessTable
  - Tailwind CSS v4 dark theme

Rust Backend (Tauri + sysinfo + tokio)
  - sysinfo crate: CPU, RAM, disk, network, processes, temperatures
  - tokio async runtime
  - Background loop emits "metrics_update" every 1500ms
  - One-shot "get_metrics" command for initial load
```

## Performance Design

- **No mock data** — all metrics come from the real OS via `sysinfo`
- **Ring buffers** for history — O(1) append, no array copy
- **Two tick rates**: fast scalars (1500ms), slow histories (every 3rd tick ≈ 4.5s)
- **Selector subscriptions**: each component only re-renders when its slice changes
- **CSS transitions** for gauge/sparkline animation — GPU composited
- Process list capped at top 50 by CPU

## Dev

```bash
npm install
npm run tauri dev    # starts Vite dev server + Rust backend
```

## Build

```bash
npm run tauri build  # produces macOS .dmg / Windows .exe / Linux .AppImage
```

## What's integrated

- ✅ Real CPU usage, per-core breakdown, frequency, model, load avg
- ✅ Real memory: used/available/total, swap
- ✅ Real disk: mount points, usage %, filesystem type
- ✅ Real network: per-interface bytes, computed bps rates
- ✅ Real processes: top 50 by CPU, memory bytes
- ✅ Temperature sensors (where available via sysinfo)
- ✅ Health status derived from live data

## Remaining / TODO

- [ ] Individual drill-down panels (CPU, Memory, Disk, Network, Processes detail views)
- [ ] macOS specific: powermetrics for accurate per-core temps (needs sudo)
- [ ] GPU metrics (nvml for NVIDIA, IOKit/Metal for Apple Silicon)
- [ ] Alert thresholds with system notifications
- [ ] Settings panel (refresh interval, history length, thresholds)
- [ ] System tray with mini stats
- [ ] Export / CSV logging
- [ ] Windows: WMI temperatures
