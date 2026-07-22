# Resonance

A modern desktop music player for Windows — a reimagining of Windows Media Player, focused purely on music.

Electron + React + TypeScript. Frameless glass UI on a fixed blue→purple identity, a real SQLite library, and a Web Audio engine with a 10-band equalizer.

---

## Features

**Library** — scan folders or drag files/folders onto the window. Browse by Songs, Albums, Artists, Genres and Recently Added. Virtualized lists, sortable columns, and instant full-text search across title/artist/album.

**Playback** — play/pause/stop/next/previous, draggable seek with buffered indication, volume and mute, shuffle, and repeat (off / all / one). Supports MP3, FLAC, WAV, M4A/AAC, OGG and Opus.

**Queue & playlists** — reorderable Now Playing queue, playlist CRUD with persisted drag order, and M3U/M3U8 import and export.

**Equalizer** — ten bands (31 Hz – 16 kHz, ±12 dB) with eleven presets, custom preset save, and a bypass toggle. Changes are audible while you drag.

**Desktop integration** — system tray with quick controls and a now-playing tooltip, global media keys, an always-on-top mini-player, and minimize-to-tray.

**Conveniences** — full session restore (queue, track, position, volume, EQ, theme, window geometry), crossfade, sleep timer, live folder watching, play counts, and a Properties dialog.

## Install

Download the latest **`Resonance-x.y.z-x64.exe`** from the
[Releases page](../../releases) and run it.

Windows SmartScreen will warn on first run because the build is not code-signed
— choose **More info → Run anyway**. There is also a portable build
(`Resonance-x.y.z-portable.exe`) that needs no installation.

Resonance updates itself: it checks GitHub Releases on launch, downloads new
versions in the background, and installs them when you next close the app.
You can also check manually in **Settings → Updates**.

Uninstalling deliberately leaves your library and playlists in
`%APPDATA%\Resonance`.

---

## Requirements

- **Node.js 24.x** (developed against v24.14.1)
- **Windows 11**

There is **no C++ toolchain requirement** — see [No native modules](#no-native-modules) below.

## Running in development

```bash
npm install
npm run dev
```

### ⚠ `ELECTRON_RUN_AS_NODE`

If this variable is set in your shell, **Electron runs the app as plain Node**: `require('electron')` resolves to the npm shim instead of the built-in module, `app` is `undefined`, and the app dies with a stack trace that looks like an application bug.

It *is* set in some editor and agent environments. Clear it first:

```powershell
Remove-Item Env:\ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
npm run dev
```

The Playwright harness strips it automatically (`tests/e2e/helpers.ts`).

### ⚠ Orphaned Electron processes

Resonance holds a single-instance lock, so a leftover process makes every new launch quit instantly — including test runs, which then fail with `Target page, context or browser has been closed`:

```powershell
Get-Process electron -ErrorAction SilentlyContinue | Stop-Process -Force
```

## Testing

```bash
npm test          # Vitest — pure logic (154 tests)
npm run test:e2e  # builds, then drives the real Electron app (76 tests)
```

Audio fixtures are **generated**, not committed — `tests/fixtures/gen-audio.ts` synthesizes tagged FLAC/M4A/OGG/Opus/WAV/MP3 from a tone via `ffmpeg-static`, plus a ~112 MB file for range-seek testing. First run takes a few seconds; afterwards they are reused.

Screenshots and reports land in `test-results/`.

## Building the installer

```bash
npm run dist      # NSIS installer + portable build -> release/
npm run dist:dir  # unpacked directory, faster for smoke-testing
```

Produces:

| Artifact | Size |
|---|---|
| `release/Resonance-0.1.0-x64.exe` (installer) | ~97 MB |
| `release/Resonance-0.1.0-portable.exe` | ~97 MB |

The installer is **not code-signed**, so Windows SmartScreen will warn on first run — choose *More info → Run anyway*. Signing needs a certificate you'd have to supply.

Uninstalling deliberately **leaves your library and settings** in `%APPDATA%\Resonance`. Deleting playlists and play counts because someone updated the app would be hostile.

## Publishing a new version

Releases are driven by tags. One command does the whole thing:

```bash
npm run release -- patch    # 0.1.0 -> 0.1.1   bug fixes
npm run release -- minor    # 0.1.0 -> 0.2.0   new features
npm run release -- major    # 0.1.0 -> 1.0.0   breaking changes
```

That bumps the version, tags it and pushes. GitHub Actions then runs the full
test suite, builds the Windows installer, and publishes it to a GitHub Release.
Installed copies pick the update up on their next launch.

It refuses to run on a dirty working tree — a release built from uncommitted
changes cannot be reproduced from its tag.

**First-time setup** (once, before the first push):

```bash
npm run setup-github -- <your-github-username>
```

This rewrites the commit history to use a GitHub noreply email instead of your
real one, points `repository` in `package.json` at the new repo (which is where
auto-update looks), and adds the `origin` remote. It refuses to run once a
remote exists, because rewriting published history breaks every clone.

---

## No native modules

Resonance was originally specified to use `better-sqlite3`, which must compile against Electron's Node ABI and therefore needs a working C++ toolchain. It was developed on a machine where Visual Studio 2022 registered the VC++ components but shipped no `MSBuild.exe`, so nothing native could be built at all — a situation that is easy to land in and miserable to debug.

Resonance therefore uses **`node:sqlite`**, built into Electron's bundled Node. Verified inside Electron 43.2.0 — and again inside the *packaged* build: SQLite 3.53.1, prepared statements, bulk transactions, named parameters, WAL, and FTS5.

```bash
npm run probe:sqlite   # reproduces that verification
```

Consequences:

- **No rebuild step exists**, so there is none to document. `@electron/rebuild` is not a dependency and `npmRebuild` is off.
- Every remaining runtime dependency (`music-metadata`, `chokidar`, `electron-store`) is pure JavaScript, which makes packaging considerably more reliable.
- If you have the "Desktop development with C++" workload **including MSBuild** and want `better-sqlite3` back, the database layer is isolated behind `src/main/db/index.ts` — the swap is one file.

Full reasoning and the diagnosis trail are in [PLAN.md](PLAN.md) §A7.

---

## Architecture

```
shared/          types + IPC channel names, shared by all three processes
src/main/        SQLite, filesystem, scanning, tray, shortcuts, windows, protocols
src/preload/     the only main↔renderer bridge (contextBridge, narrow + typed)
src/renderer/    all UI, and the Web Audio playback graph
tests/unit/      Vitest — pure logic
tests/e2e/       Playwright — drives the real Electron app
```

**Security.** `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. The renderer never touches the filesystem or the database; it asks main over IPC. The preload exposes named capabilities only — never a generic `invoke(channel, …)` passthrough. This is asserted by an e2e test, not just intended.

**Media never travels as a file path.** Audio and artwork reach the renderer through custom `resonance-media://` and `resonance-art://` schemes that accept only opaque IDs, resolved against the database in main. A compromised renderer cannot read arbitrary files by asking for them, and path traversal is rejected (tested).

**One audio graph.** Two `<audio>` decks are created once and reused by swapping `src`, because `createMediaElementSource` may be called only once per element — a second call kills audio silently. The mini-player owns no audio at all; it is a remote control, since two AudioContexts would mean genuine double playback.

**The design identity is fixed.** The blue→purple gradient is a token used for the player bar, active row, progress fill, play button, EQ fills and focus states, and is never derived from artwork. Album art tints exactly one surface — a clamped wash behind the Now Playing artwork.

---

## Known limitations

- **WMA is best-effort**, dependent on system codecs. It is not verified.
- **WAV cannot carry non-ASCII tags.** RIFF INFO predates Unicode, so a CJK artist comes back mangled. ID3v2, Vorbis comments and MP4 atoms all round-trip it correctly. This is a property of the format, and there is a passing test that documents it.
- **Snap Layouts hover flyout is unavailable.** That flyout attaches to the *native* maximize button, which a frameless window does not have. Win+Arrow, Win+Z, double-click-maximize and drag-to-top-maximize all still work.
- **Smart playlists were cut from scope.** Play counts and last-played are tracked, so they remain cheap to add.
- **The installer is unsigned** (see above).
- **x64 only** — an untested arm64 binary would be worse than none.
