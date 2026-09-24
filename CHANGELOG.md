## [Unreleased]

### Added
- **NVIDIA GPU telemetry on Linux and Windows** via `nvidia-smi` (utilization, VRAM, temperature, clock), with a 2 s timeout and no console-window flash on Windows.
- **Windows GPU utilization and dedicated VRAM** from the `GPU Engine` / `GPU Adapter Memory` perf counters (the same source Task Manager uses), matched to the selected adapter by LUID.
- Linux GPU: AMD VRAM usage, AMD/Intel clock speed, and smarter card selection on hybrid (iGPU + dGPU) systems.
- `frequency_mhz` GPU field (macOS powermetrics frequency no longer overloads `power_state`).
- "Start in Tray", "Bytes Format" (SI vs. binary) and warning-threshold settings are now actually applied.
- Platform-aware UI: tray vs. menu bar wording, Windows "End Task" / Linux "Terminate · Kill" / macOS "Quit · Force Quit" process actions, and hiding Apple-only GPU fields elsewhere.
- Rust unit tests plus a cross-platform collector smoke test, run in CI on macOS, Windows and Linux.

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

### Security
- Enabled a Content Security Policy for the webview.
- `terminate_process` refuses to kill ResourceScope itself.

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
