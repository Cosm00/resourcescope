# Contributing to ResourceScope

Thanks for your interest in contributing! Here's how to get started.

## Development Setup

1. **Clone the repo**
   ```bash
   git clone https://github.com/cosm00/resourcescope.git
   cd resourcescope
   ```

2. **Install prerequisites**
   - [Rust](https://rustup.rs/) (stable toolchain)
   - [Node.js](https://nodejs.org/) 18+
   - OS-specific Tauri prerequisites → [tauri.app/start/prerequisites](https://tauri.app/start/prerequisites/)

3. **Install Node dependencies**
   ```bash
   npm install
   ```

4. **Start the dev server**
   ```bash
   npm run tauri dev
   ```

## Project Structure

```
resourcescope/
├── src/                 # React/TypeScript frontend
│   ├── components/      # UI components (Dashboard, Sidebar, etc.)
│   ├── store/           # Zustand state store
│   └── types.ts         # Shared TypeScript types
└── src-tauri/           # Rust/Tauri backend
    └── src/
        ├── lib.rs        # Tauri app setup & command registration
        ├── metrics.rs    # sysinfo polling, data collection
        └── gpu.rs        # GPU metrics (WIP)
```

## Guidelines

- **Keep the binary lean** — avoid heavy dependencies. Prefer `sysinfo` for new metrics before reaching for OS-specific APIs.
- **Real data only** — no mocks or hardcoded values in the metrics pipeline.
- **TypeScript** — all frontend code must be typed; `any` is not allowed.
- **Rust** — run `cargo clippy` before opening a PR; no warnings.
- **Commits** — use [conventional commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `chore:`, etc.).

## Opening a Pull Request

1. Fork the repo and create a branch from `main`.
2. Make your changes with focused, atomic commits.
3. Make sure `npm run build` and `cargo build` both pass.
4. Open a PR with a clear description of what you changed and why.

## Reporting Bugs

Please open a [GitHub Issue](../../issues) with:
- OS and version
- Steps to reproduce
- Expected vs. actual behavior
- Any relevant console/log output

## Feature Requests

Open an Issue labeled `enhancement`. Check the [Roadmap in the README](README.md#roadmap) first — it may already be planned.
