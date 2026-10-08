## [1.3.1] - 2026-10-08

### Changed
- **Process lists hold still while you point at them.** In the Processes tab and the Overview's Top Processes table, rows keep their order while the pointer is over the list (values keep updating live), so the row you're aiming for no longer jumps away as rankings change. A process that exits meanwhile stays in place, dimmed, new ones are added at the bottom, and the list re-sorts a moment after the pointer leaves. An "Order held" badge shows while this is active; clicking a column header re-sorts immediately.

## [1.3.0] - 2026-09-29

### Added
- **Per-process network usage:** a Network column in the Processes tab (sortable, summed per app), network in/out in process details, and "Top Network Processes" on the Network tab. Linux counts TCP from the kernel's socket statistics (your own processes without root); macOS uses `nettop` (TCP + UDP); Windows uses kernel network events (ETW), which Windows only allows for administrators — otherwise the UI says so. Loopback traffic is excluded everywhere.
- **GPU temperatures on Windows for AMD and Intel** (and NVIDIA without `nvidia-smi`), from the driver-reported adapter performance data that Task Manager shows (WDDM 2.4+ drivers).
- **Intel GPU utilization on Linux** (i915 and xe): from the i915 PMU when permitted (root / `perf_event_paranoid`), otherwise from DRM fdinfo engine counters (Linux 5.19+ for i915, 6.8+ for xe).
- **macOS multi-GPU:** every IOAccelerator is listed (integrated Intel + discrete AMD/NVIDIA on Intel Macs, eGPUs), with AMD temperature and core clock where the driver reports them.
- **Per-core CPU temperatures:** a Core Temperatures card on the CPU tab — Intel cores and AMD CCDs on Linux, P-/E-core cluster sensors on Apple silicon, and per-core SMC sensors on Intel Macs. No root or `powermetrics` needed.

### Fixed
- **Windows: double-clicking the app could do nothing.** The window now opens before the sensor collectors start (a slow WMI / GPU query can no longer keep it from appearing), launching the app again brings back an instance that's already running — often hidden in the tray's overflow — instead of starting an invisible second copy, and a failure to start shows an error message and is logged to `%LOCALAPPDATA%\com.cosm00.resourcescope\logs\startup.log`.
- Releases are published automatically once every platform has built, instead of staying drafts (nothing after 1.1.6 was public, and in-app updates only see published releases). A manual run can also publish an existing draft.
- macOS no longer spawns a doomed `powermetrics` every few seconds when it isn't running as root and no helper is installed.
- macOS GPU vendor detection no longer calls every GPU "Apple" when system_profiler has no match.

## [1.2.1] - 2026-09-29

### Added
- **Automatic updates** (once a signing key is configured): background checks every 6 hours, silent signature-verified downloads, a notification and a "Restart to update" button. Settings toggles for automatic checking and downloading.

### Fixed
- Release workflow validates the Apple notarization key up front and accepts keys pasted with literal `\n`, instead of failing late with `invalidPEMDocument`.

## [1.2.0] - 2026-09-24

### Added
- **NVIDIA GPU telemetry on Linux and Windows** via `nvidia-smi` (utilization, VRAM, temperature, clock), with a 2 s timeout and no console-window flash on Windows.
- **Windows GPU utilization and dedicated VRAM** from the `GPU Engine` / `GPU Adapter Memory` perf counters (the same source Task Manager uses), matched to the selected adapter by LUID.
- Linux GPU: AMD VRAM usage, AMD/Intel clock speed, and smarter card selection on hybrid (iGPU + dGPU) systems.
- `frequency_mhz` GPU field (macOS powermetrics frequency no longer overloads `power_state`).
- "Start in Tray", "Bytes Format" (SI vs. binary) and warning-threshold settings are now actually applied.
- Platform-aware UI: tray vs. menu bar wording, Windows "End Task" / Linux "Terminate · Kill" / macOS "Quit · Force Quit" process actions, and hiding Apple-only GPU fields elsewhere.
- Rust unit tests plus a cross-platform collector smoke test, run in CI on macOS, Windows and Linux.
- **All processes, grouped by app.** The Processes tab lists every process (virtualized), groups helpers under their app (bundle / executable), shows per-process disk I/O and run time, loads command line and working directory on demand, and can end a whole app with a confirming second click. Other views still receive only the busiest processes to keep each tick light.
- **Disk activity:** live read/write rates per volume and per process, with a Disk tab activity card.
- **Battery:** charge, time remaining, health, cycles and power draw (top bar, Health panel, tray tooltip).
- **History tab:** 30 days of metrics (10-second buckets for 24 h, 5-minute beyond) persisted across restarts; 1h–30d charts with a table view; CSV export through a native save dialog; optional continuous daily CSV logging.
- **Desktop alerts** for sustained high CPU/memory, full disks, hot CPU/GPU and low battery, evaluated in the backend so they fire while hidden in the tray.
- **Launch at login** (starts hidden in the tray) and **update checks** with an "Update available" pill; one-click signed updates once a key is configured (docs/auto-updates.md).
- **Multi-GPU:** every GPU is listed with a picker in the GPU tab; NVIDIA cards are matched to `nvidia-smi` by PCI bus id on Linux.
- **Light theme** (System / Dark / Light) and a responsive overview down to the 960 px minimum window width.
- ESLint and Vitest, run in CI alongside the Rust tests.

### Fixed
- Command line, working directory and user were empty for every process started after launch (sysinfo only loaded them once).
- Process owner now shows the user name instead of `Uid(501)` / raw SIDs.
- Network rates could be attributed to the wrong interface when adapters appeared or disappeared (VPN, Wi-Fi toggle); rates are now keyed by name using a monotonic clock.
- Windows loopback adapter is filtered; interfaces like `lowpan0` are no longer hidden by the `lo` prefix check.
- Disk list hides pseudo filesystems (tmpfs, overlay, snap squashfs, APFS system volumes), picks up hot-plugged drives, and lists the system volume first so the dashboard, health checks and tray agree on the "primary" disk.
- Disk scanner counted only three directory levels deep; it now walks the full tree (without following symlinks or crossing devices) under an entry/time budget, and returns proper errors.
- Disk breadcrumbs broke on Windows paths (and duplicated segments for non-root mounts); they are now built natively.
- Disk scans and the initial metrics request ran on the main thread and froze the UI; they now run on a background pool.
- The metrics loop ran blocking collection inside the async runtime; it now has its own thread and a steady cadence.
- Tray title refresh used the startup interval instead of the current one.
- CPU temperature detection now recognises AMD (`Tctl`/`Tdie`), ARM SoC and ACPI sensors and prefers package readings.
- Windows GPU memory total reported shared system memory (often 2x too large) for discrete cards.
- Closing the window on a desktop without a system tray no longer leaves the app running invisibly.
- Changing a setting no longer tears down the live metrics subscription.
- macOS GPU helper no longer spawns a login shell on every poll.
- Linux listed every userland thread as a process, double-counting its parent's CPU and memory.
- The Network tab's sparklines flat-lined above ~130 KB/s (fixed scale).
- GPU gauge and sparkline had no colour (`--accent-pink` was never defined).
- Health and Disk badges had no background (hex alpha appended to a CSS variable).
- Dark theme muted text contrast raised from 2.3:1 to 3.7:1.

### Security
- Enabled a Content Security Policy for the webview.
- `terminate_process` refuses to kill ResourceScope itself.

### Changed
- CI and releases use Node 22 (Node 20 is end-of-life).
- `@tauri-apps/api` is pinned to the same minor as the Rust `tauri` crate (the CLI refuses mismatches).

### Removed
- Unused legacy view components and the no-op "Compact Mode" setting.

## [1.1.3] - 2026-04-20

### Fixed
- Retry release after refreshing APPLE_CERTIFICATE_P12_BASE64 secret for macOS signing.

## [1.1.2] - 2026-04-20

### Fixed
- Retry release with corrected Developer ID Application certificate for macOS signing/notarization.

## [1.1.1] - 2026-04-19

### Fixed
- Release workflow now includes macOS signing / notarization scaffolding using Developer ID Application and App Store Connect API key credentials.
- Follow-up release to validate signed/notarized GitHub artifacts.

## [1.1.0] - 2026-04-19

### Added
- Dedicated GPU panel with device-level deep-dive metrics and usage trends.
- Recursive disk storage examiner with clickable path drilldown.
- Breadcrumb navigation for disk path exploration.
- Treemap-style storage visualization for scanned directories/files.
- Menubar display customization with selectable metric modes and independent refresh interval.
- Tab-specific top process ranking panels for CPU and Memory views.

### Improved
- Overview cards are now standardized in height and act as click-through navigation shortcuts.
- Network deep-dive now includes busiest interfaces plus recent peak/average traffic summaries.
- Disk tab now behaves like an actual storage investigation tool instead of a static usage page.

## [1.0.1] - 2026-04-19

### Added
- Richer process attribution with app name, parent process, executable path, bundle hints, and friendly explanations for common macOS daemons.
- Clickable overview cards that jump directly into CPU, Memory, GPU, Network, and Disk deep-dive tabs.
- Menubar/tray metric customization with selectable display mode and independent refresh interval.
- Disk storage examiner with on-demand top-level path scanning and per-volume usage contribution.

### Improved
- Processes panel now provides a detailed inspector view for understanding what a process is and what likely owns it.
- Settings now expose menubar stats controls directly in the UI.

# Changelog

All notable changes to ResourceScope will be documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2026-03-28

### Added
- Built out CPU, Memory, Disk, Network, Processes, and Settings views
- Added persisted settings store and live refresh interval control
- Added richer system-monitor dashboard coverage beyond the initial overview

### Changed
- Polished the app from a partial prototype into a full multi-view desktop monitor


## [0.1.1] - 2026-03-28

### Changed
- Added GitHub Actions CI/release automation for macOS, Windows, and Linux artifacts
- Fixed blank Tauri UI issue on macOS WebKit builds

## [0.1.0] - 2026-03-28

### Added
- Initial public release
- Real-time CPU, memory, disk, and network monitoring via `sysinfo`
- Tauri v2 + React/TypeScript frontend
- Recharts-based live graphs
- System tray icon support
- macOS, Windows, and Linux builds
