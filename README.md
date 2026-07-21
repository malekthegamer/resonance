# Resonance

A modern desktop music player for Windows — a reimagining of Windows Media Player, focused purely on music.

Electron + React + TypeScript, frameless glass UI on a fixed blue→purple identity.

> **Status: slice 0 of 10 complete** (scaffold & spine). See [PLAN.md](PLAN.md) for the full staged build plan, the amendment log, and the gate results.

---

## Requirements

- **Node.js** 24.x (developed against v24.14.1)
- **Windows 11** (the only supported target)

There is **no C++ toolchain requirement** — see "No native modules" below.

## Running in development

```bash
npm install
npm run dev
```

### ⚠ `ELECTRON_RUN_AS_NODE`

If this variable is set in your shell, **Electron will run the app as plain Node**: `require('electron')` resolves to the npm shim instead of the built-in module, `app` is `undefined`, and the app dies with a confusing stack trace that looks like an application bug.

This variable *is* set in some editor and agent environments. Clear it before launching:

```powershell
Remove-Item Env:\ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
npm run dev
```

The Playwright test harness strips it automatically (`tests/e2e/helpers.ts`).

### ⚠ Orphaned Electron processes

Resonance holds a single-instance lock, so a leftover Electron process makes every
new launch quit instantly — including test runs, which then fail with
`Target page, context or browser has been closed`. If that happens:

```powershell
Get-Process electron -ErrorAction SilentlyContinue | Stop-Process -Force
```

## Testing

```bash
npm test        # Vitest — pure logic (formatting, and later queue/M3U/EQ)
npm run test:e2e  # builds, then drives the real Electron app via Playwright
```

E2E screenshots are written to `test-results/`.

## Building the installer

```bash
npm run dist      # NSIS installer + portable build (slice 9)
npm run dist:dir  # unpacked directory, faster for smoke-testing
```

## No native modules — and why

The spec originally called for `better-sqlite3`. That requires compiling against Electron's Node ABI, which needs MSBuild. **This machine has Visual Studio 2022 with the VC++ components registered but no `MSBuild.exe` installed at all**, so no native module can be built here.

Resonance therefore uses **`node:sqlite`**, built into Electron's bundled Node. Verified working inside Electron 43.2.0: SQLite 3.53.1, prepared statements, bulk transactions, named parameters, WAL, and FTS5.

```bash
npm run probe:sqlite   # reproduces that verification
```

Consequences:

- **No rebuild step exists**, so there is none to document. `@electron/rebuild` is not a dependency.
- Every remaining dependency (`music-metadata`, `chokidar`, `electron-store`) is pure JavaScript, which makes packaging considerably more reliable.
- If you later install the "Desktop development with C++" workload **including MSBuild** and want `better-sqlite3` back, the database layer is isolated behind `src/main/db/index.ts` so the swap is one file.

Full reasoning and the diagnosis trail are in [PLAN.md](PLAN.md) §A7.

## Project layout

```
shared/          types + IPC channel names, shared by all three processes
src/main/        SQLite, filesystem, scanning, tray, shortcuts, windows
src/preload/     the only main↔renderer bridge (contextBridge, narrow + typed)
src/renderer/    all UI, and the Web Audio playback graph
tests/unit/      Vitest — pure logic
tests/e2e/       Playwright — drives the real Electron app
```

Security posture: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. The renderer never touches the filesystem or the database; it asks main over IPC. The preload exposes named capabilities only — never a generic `invoke(channel, ...)` passthrough. This is asserted by an e2e test, not just intended.
