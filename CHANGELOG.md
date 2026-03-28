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
