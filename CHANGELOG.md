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
