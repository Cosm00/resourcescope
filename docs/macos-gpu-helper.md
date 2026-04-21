# macOS GPU Helper Strategy

ResourceScope can collect richer macOS GPU telemetry from `powermetrics`, but `powermetrics` requires elevated privileges.

## Current strategy order

The app tries these sources in order:

1. `RESOURCESCOPE_GPU_HELPER` command (if set)
2. `/usr/local/bin/resourcescope-gpu-helper` (if installed)
3. direct `powermetrics` invocation
4. non-elevated collectors (`system_profiler`, `ioreg`)

## Intended evolution

To fully finish this for product use, the app should move from shell-command helpers to a structured privileged helper model.

### Proposed protocol

A helper should emit one JSON object to stdout, for example:

```json
{
  "backend": "macos-powermetrics-helper",
  "active_residency_pct": 42.7,
  "frequency_mhz": 812,
  "power_mw": 5400,
  "notes": "Privileged helper collected GPU telemetry via powermetrics."
}
```

### Why JSON

- easier to parse than raw plist/text
- stable contract between app and helper
- allows helper versioning later

## Near-term implementation options

### Simple helper wrapper
- helper runs `powermetrics`
- helper converts result to JSON
- helper is installed/run with privileges externally

### True privileged helper
- launchd or SMJobBless-style helper
- local IPC/socket or stdout wrapper command
- signed and installed as part of app deployment

## Reality check

A true privileged helper cannot be fully installed from an unprivileged Discord tool session. The app can support the path in code, but local machine setup still requires elevated system configuration.
