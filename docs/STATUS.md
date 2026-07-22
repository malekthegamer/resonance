# Status

Version **0.1.4** · 154 unit tests, 77 e2e tests, all passing · shipped and in
daily use.

Everything in the original spec is built except smart playlists, which were cut
deliberately. What follows is what is *not* done, what is known-broken, and what
is unverified. Verified means it was executed and observed, not reasoned about.

---

## Verified working

Library scanning, all five browse views, virtualized sortable table, FTS search,
drag-and-drop of files/folders/playlists, full transport with shuffle and all
three repeat modes, reorderable queue, playlist CRUD with persisted drag order,
M3U/M3U8 import and export, 10-band EQ with presets, spectrum visualizer, Now
Playing with art-sampled aurora, system tray, global media keys, mini-player,
crossfade, sleep timer, full session restore including window geometry, live
folder watching, play counts, properties dialog, packaging, and **auto-update
(confirmed by the user upgrading 0.1.3 → 0.1.4)**.

Measured evidence lives in the commit messages — FFT tripwire readings,
range-seek timings, per-format scan counts.

---

## Gaps

Ordered roughly by how much they'd improve the app.

### No track selection model
Single-click does nothing; only double-click plays and right-click opens the
menu. There is no multi-select, so "add these 12 tracks to a playlist" means
twelve right-clicks. Probably the biggest usability gap. Would need a selection
store, shift/ctrl-click ranges, and context-menu actions that operate on the
selection.

### Smart playlists — cut from scope
"Most Played" and "Recently Added (auto)" were dropped. `play_count` and
`last_played` are tracked and indexed, so this is mostly a query plus a sidebar
entry.

### No drag-to-playlist
Tracks reach playlists only through the context menu. Dragging rows onto a
sidebar playlist is the obvious interaction and `@dnd-kit` is already a
dependency.

### Untagged libraries have three empty views
Albums, Artists and Genres are one "Unknown" bucket when files carry no tags.
**This is intentional** — filename inference was built and reverted at the
user's request; see [DECISIONS.md](DECISIONS.md). A tag *editor* would be the
honest fix: let the user set real metadata rather than have the app guess.

### No queue persistence UI
The queue restores across restarts but cannot be saved as a playlist, and there
is no "clear queue" button.

### Windows only
`electron-builder.yml` targets `win` and **x64 only**. macOS/Linux would need
tray icon work, different window chrome handling, and the frameless decisions in
`windows/main.ts` revisited.

---

## Known limitations (won't fix / can't fix)

**WAV cannot carry non-ASCII tags.** RIFF INFO predates Unicode, so a CJK artist
comes back mangled. ID3v2, Vorbis comments and MP4 atoms all round-trip
correctly. A passing test documents this so it isn't rediscovered as a bug.

**Snap Layouts hover flyout is unavailable.** That flyout attaches to the
*native* maximize button, which a frameless window does not have. Win+Arrow,
Win+Z, double-click-maximize and drag-to-top all work. Reversing this means
giving up the edge-to-edge glass.

**The installer is unsigned**, so SmartScreen warns on first run. Fixing it
needs a code-signing certificate (~$100–400/yr).

**WMA is best-effort and unverified.** It depends on system codecs. No test
covers it.

---

## Known issues

**GitHub Actions emits a Node 20 deprecation warning.** `actions/checkout@v4`,
`setup-node@v4` and `upload-artifact@v4` target Node 20 and are being forced onto
Node 24. Harmless today; bump to `@v5` when convenient.

**Playlists can reference files that no longer exist.** Import reports them as
missing rather than dropping them silently — this is intended behaviour, not a
bug. The author's own ReZero playlist has one such entry
(`Re_Zero Ending 2 [Stay Alive].mp3`).

**Closing the window does not quit the app.** Minimize-to-tray is on by default,
so ✕ hides to tray. Quit via the tray menu. This surprises people, including
during development — a running instance holds the single-instance lock.

---

## Test coverage notes

**Unit (154)** — queue state machine (exhaustive across shuffle × repeat ×
end-of-list), M3U parsing/writing, EQ presets and clamping, sleep timer,
grouping/sorting, filename→title repair, database schema and migrations,
generated fixture integrity.

**E2E (77)** — drives the real Electron app across 11 spec files. Highlights
worth preserving:

- `playback.spec.ts` — the **FFT silence tripwire**: measures analyser peak over
  ~500ms on a −6 dBFS tone with a paused negative control. This is the only
  thing that distinguishes real audio from a graph that reports playing while
  producing silence. Do not weaken it.
- `playback.spec.ts` — range seek into a **112 MB** file, proving byte-range
  requests rather than a full download.
- `eq-nowplaying.spec.ts` — §A4 identity check with deliberately extreme covers.
- `session.spec.ts` — restore across a genuine quit and relaunch, not a reload.
- `navigation.spec.ts` — regressions for the sidebar and rename bugs.

**Not covered:** WMA playback, code-signed installs, multi-monitor DPI changes,
libraries in the 10k+ range (the largest real test is ~100 tracks), and
auto-update itself (verified manually by the user; a CI test would need two
published releases).

---

## Reproducing CI locally

CI has no music folder and a 1024×768 display. Both have caused failures that
passed locally:

```bash
# no ~/Music, as on a runner
USERPROFILE=/tmp/empty HOME=/tmp/empty npx playwright test
```
