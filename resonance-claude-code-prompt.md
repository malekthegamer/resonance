# Resonance — Build Prompt for Claude Code

> Paste everything below the line into Claude Code. It's written as a direct instruction to the agent.

---

You are building **Resonance**, a desktop music player for Windows — a modern, better-looking reimagining of Windows Media Player, focused purely on **music**. This is a real, shippable desktop application, not a web app and not a prototype. Build it to production quality.

## How I want you to work (read this first)

Do not free-associate a giant untested build. Work in disciplined stages:

1. **UNDERSTAND** — Restate the objective as a checkable definition of done. List your load-bearing assumptions about the environment and confirm the cheap ones (Node version, OS, native-module build).
2. **PLAN** — Write a `PLAN.md` before writing app code. It must contain: ordered build stages each with an exit criterion; a file map (every file you'll create, one line of purpose); a risk register naming the *specific* failure modes for this app (audio-context lifecycle, native-module rebuild for Electron, IPC security, memory leaks from orphaned audio nodes/listeners, large-library scan performance); and which manual/automated test proves each stage.
3. **GATE** — Audit the plan (every stage has an exit criterion, every file is used, risks are covered). Fix and re-check before building.
4. **BUILD** — Implement stage by stage, in plan order. Complete and check one stage before starting the next. Never build everything and test at the end. Prefer boring, dependency-light implementations; justify every new dependency in one line.
5. **SELF-TEST** — After each stage, actually run it. Paste the real command and real output. If something can't be verified in your environment (e.g. audio playback, tray behavior), say so plainly and tell me exactly what to click to verify it myself.
6. **VERIFY** — Re-read this spec clause by clause and check each feature against what you built. For anything visual, describe what I should see at named checkpoints.
7. **REPORT** — End with an honest status: what's done, what's partial, what's unverified, known gaps, and next steps. Never claim "done" with failing or skipped checks.

If any requirement here is ambiguous or you hit a fork the plan didn't cover, stop and ask me one precise question rather than guessing.

## Tech stack

- **Electron** (desktop shell, Windows target) + **React** + **TypeScript**.
- Scaffold with **electron-vite** (Vite-powered main/preload/renderer). Fast HMR, clean structure.
- **Security defaults on:** `contextIsolation: true`, `nodeIntegration: false`, `sandbox` where possible. All main↔renderer communication goes through a **preload script using `contextBridge`** exposing a narrow, typed API. Never expose raw Node/`ipcRenderer` to the renderer.
- **Audio engine:** an `<audio>` element wired into the **Web Audio API** via `MediaElementAudioSourceNode`. This one graph drives playback, the equalizer, and the visualizer.
- **Library database:** **better-sqlite3** in the main process (fast, synchronous), accessed only via IPC. Note it's a native module — set up **electron-rebuild** (or electron-vite's native handling) so it compiles against Electron's Node ABI, and document the rebuild step in the README.
- **Metadata & album art:** the **music-metadata** package to read ID3/Vorbis/FLAC tags and embedded artwork.
- **Small app settings** (theme, volume, window state, EQ preset): **electron-store**.
- **Animations:** Framer Motion for React transitions plus CSS; keep them smooth (60fps) and purposeful, never janky.
- **Packaging:** **electron-builder**, producing a Windows **NSIS installer (.exe)** and a portable build. App name "Resonance", with a proper app icon.

Target environment: **Windows 11**, Node.js current LTS.

## Architecture

- **Main process** owns: the SQLite library DB, all filesystem access (folder scanning, file reads), the system tray, global shortcuts, window management (main window + mini-player window), and packaging concerns.
- **Renderer** owns: the entire UI and the Web Audio playback graph. It never touches the filesystem or DB directly — it asks the main process over IPC.
- **Preload** exposes a typed `window.resonance` API (e.g. `library.scanFolder()`, `library.getTracks()`, `playlists.create()`, `settings.get()`, `tray.updateNowPlaying()`, `shortcuts.onMediaKey()`).
- Keep a clean separation: `main/`, `preload/`, `renderer/` (with `renderer/audio/`, `renderer/components/`, `renderer/state/`, `renderer/styles/`).

## Core features (the Windows Media Player baseline — all required)

**Playback**
- Play, pause, stop, next, previous, seek (draggable progress bar with buffered/elapsed indication), volume slider + mute.
- **Shuffle** and **repeat** (off / repeat-one / repeat-all).
- A visible, reorderable **Now Playing queue** (drag to reorder, remove items, "play next" / "add to queue" from anywhere).
- Accurate time display (elapsed / total), and playback logic that's rock-solid: correct track advancement, no double-fires, correct behavior at track end under shuffle/repeat combinations.
- Supported formats: **MP3, FLAC, WAV, M4A/AAC, OGG/Opus**. (WMA depends on system codecs — attempt it, but it's acceptable to note it as best-effort.)

**Library management**
- Add music by **picking folders** to watch/scan, and by **drag-and-dropping files or folders** onto the window.
- On scan: parse metadata, extract and cache album art, and build a library organized by **Songs, Albums, Artists, and Genres**, plus **Recently Added** and a flat **All Songs** view.
- Library views should be a fast, **sortable, filterable table/grid** (sort by title, artist, album, duration, date added; instant filter as you type).
- Handle large libraries without freezing the UI (scan off the UI thread / in the main process, stream progress to the renderer, paginate or virtualize long lists).
- Global **search** across title / artist / album (fast, incremental).

**Playlists**
- Create, rename, delete playlists.
- Add/remove tracks; **drag-and-drop to reorder**.
- Persist playlists in the DB.
- **Import and export M3U/M3U8.**
- A couple of **smart/auto playlists** would be a nice touch (e.g. "Recently Added", "Most Played") — include if it doesn't blow the scope.

**Now Playing screen**
- Large album art, track/artist/album, progress, and controls.
- Include a **simple audio visualizer** (spectrum bars or waveform driven by a Web Audio `AnalyserNode`) — this is core WMP DNA. Keep it lightweight and let the user toggle it off. (Lower priority than the items below; don't let it eat the schedule.)

## The features I specifically want (priorities)

**10-band graphic equalizer**
- Ten `BiquadFilterNode` peaking filters at roughly **31, 62, 125, 250, 500, 1k, 2k, 4k, 8k, 16k Hz**, each ±12dB via a slider.
- Built-in **presets** (Flat, Bass Boost, Treble Boost, Vocal, Rock, Pop, Electronic, etc.) plus the ability to save a custom preset.
- Live — changing a band updates the sound immediately. Persist the last-used EQ state.

**Global hotkeys + media keys**
- Register global shortcuts via Electron `globalShortcut` so playback is controllable even when Resonance isn't focused: **MediaPlayPause, MediaNextTrack, MediaPreviousTrack**, plus volume up/down.
- Let the user see the shortcut list (and ideally customize it) in Settings.

**Mini-player mode**
- A compact, **frameless, always-on-top** secondary window showing album art, track info, and quick controls (prev / play-pause / next, progress, volume).
- Toggle between main window and mini-player; remember position.

**System tray (the new feature WMP lacks)**
- A tray icon that stays present. Its context menu has **quick Play/Pause, Next, Previous**, plus Show Resonance and Quit.
- The tray tooltip/title reflects the **current track** ("♪ Artist – Title").
- Closing/minimizing the main window can minimize to tray (make this a setting) rather than quitting.

## Smaller conveniences (bake these in)

- **Remember last session:** restore queue, current track + position, volume, EQ, theme, and window state on relaunch.
- **Crossfade** between tracks (adjustable duration, 0 = off) using a two-source gain ramp; **preload the next track** for near-gapless transitions.
- **Sleep timer** (stop after N minutes or after the current track).
- **Keyboard shortcuts** in-app: Space = play/pause, ←/→ = seek, ↑/↓ = volume, Ctrl+F = search, etc.
- **Play count / last-played** tracking per song (feeds "Most Played").
- Right-click context menus on tracks (Play, Play next, Add to queue, Add to playlist, Show in folder, Properties/metadata).
- Graceful handling of **missing/moved files** (mark unavailable, don't crash).

## Visual & UX design

- **Theme:** blue→purple gradient identity. Ship **both dark and light** with a toggle; **default to dark**.
  - Dark: a deep near-black/charcoal base (roughly `#0d0d14`) with the blue→purple gradient (about `#4f7cff` → `#9b5cff`) as the accent — used on the active-track highlight, progress bar fill, play button, EQ sliders, and focus states.
  - Light: soft off-white base with the same gradient accents, kept tasteful and readable.
- **Feel:** clean, modern, spacious. Rounded corners, subtle depth/glassy panels, gradient accents rather than flat gray. A gradient progress bar and an animated, satisfying play/pause button.
- **Animations:** smooth 60fps transitions — view changes, hover states, the play button morph, album-art crossfades, the visualizer. Purposeful, never gratuitous or laggy.
- **Layout (suggested):** left sidebar (Library sections, Playlists), main content area (current view / Now Playing), and a persistent bottom **player bar** (art thumbnail, track info, transport controls, progress, volume, EQ/queue/mini-player buttons).
- Custom app + tray icon that reads as "Resonance".

## Data model (guide, refine as needed)

- `tracks` (id, path, title, artist, album, album_artist, genre, year, track_no, duration, bitrate, art_ref, date_added, play_count, last_played, available)
- `albums`, `artists` (derived or normalized — your call, justify it)
- `playlists` (id, name, created_at) and `playlist_tracks` (playlist_id, track_id, position)
- `settings` / session state (via electron-store or a settings table)

## Definition of done (acceptance criteria)

The build is done when, on Windows 11:

1. I can point Resonance at a music folder, watch it scan with visible progress, and browse the result by Songs / Albums / Artists / Genres, sorted and searchable.
2. I can play music with full, correct transport controls, shuffle/repeat, a working reorderable queue, and accurate timing.
3. The **10-band EQ** audibly changes the sound in real time and its presets work.
4. **Global media keys** control playback when the app is in the background.
5. The **mini-player** and **system-tray quick controls** both work, and the tray shows the current track.
6. **Playlists** can be created, edited, reordered, and imported/exported as M3U.
7. The app **restores my full session** on relaunch, and **crossfade + sleep timer** work.
8. The UI matches the blue→purple identity, dark/light toggle works (default dark), and animations are smooth.
9. `electron-builder` produces a working **Windows installer** that installs and launches Resonance.
10. A `README.md` explains how to run in dev, the native-module rebuild step, and how to build the installer.

## Deliverables

- The full source tree, `PLAN.md`, a `README.md`, and a working `electron-builder` config that outputs a Windows `.exe` installer.
- A final honest status report per the "How I want you to work" section: what's verified, what needs my manual check, and any gaps.

Start with **UNDERSTAND** and **PLAN.md**. Show me the gated plan before you write app code.
