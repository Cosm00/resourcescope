# ResourceScope 1.0.0 — process attribution + menubar stats

## What's new

### Better process analysis
ResourceScope now gives much more useful detail for high-CPU / high-memory processes.

New process metadata includes:
- app attribution
- parent process name / PID
- executable path
- working directory
- command line
- process kind (system service, app process, helper process, CLI tool, background process)
- bundle/app hint
- friendly labels for common macOS daemons
- “what is this?” explanations for common system processes

Examples:
- `mediaanalysisd` now shows as an Apple media analysis service with context about Photos / Spotlight / media indexing.
- Spotlight-related processes like `mds`, `mdworker_shared`, and `corespotlightd` now get friendlier explanations.

### Improved Processes UI
- Added **App** attribution column
- Added richer filtering (name, app, path, PID, parent)
- Added click-to-inspect side panel for details
- Added better labels and grouping for system/helper/app-owned processes

### Menubar / tray stats
- Added live **CPU %** and **Memory %** display in the menubar / tray title when supported
- Added a visible Settings toggle for this behavior

## Built artifacts
- App binary: `src-tauri/target/release/resourcescope`
- App bundle: `src-tauri/target/release/bundle/macos/ResourceScope.app`
- DMG: `src-tauri/target/release/bundle/dmg/ResourceScope_1.0.0_macOS_aarch64.dmg`

## Notes
- The default Tauri DMG wrapper failed in this environment, but a manual DMG was successfully created and renamed to the release artifact above.
