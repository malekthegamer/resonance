# Status

Version **0.1.4** · 271 unit tests, 113 e2e tests, all passing · shipped and in
daily use.

Unreleased on `master`: track selection, drag-to-playlist, and the tag editor
(write core plus dialog). Not yet released — that is the remaining work.

Everything in the original spec is built except smart playlists, which were cut
deliberately. What follows is what is *not* done, what is known-broken, and what
is unverified. Verified means it was executed and observed, not reasoned about.

---

## Verified working

Library scanning, all five browse views, virtualized sortable table with
click/ctrl/shift multi-select, dragging selected tracks onto a sidebar playlist
or the queue, a tag editor that writes real tags into files (single and
multi-track, cover art, fill-from-filename, one-time backups), FTS search,
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

### Smart playlists — cut from scope
"Most Played" and "Recently Added (auto)" were dropped. `play_count` and
`last_played` are tracked and indexed, so this is mostly a query plus a sidebar
entry.

### Library rows cannot be dragged by keyboard
Drag-to-playlist is pointer-only. dnd-kit's keyboard sensor activates on
Enter/Space, which already mean "play" on a track row, and there is no sensible
keyboard path from the table to a sidebar drop target. The context menu does
everything dragging does, so this is an ergonomics gap rather than a dead end.

### Untagged libraries still start as three empty views
Albums, Artists and Genres are one "Unknown" bucket until files carry tags.
**Inferring them automatically is intentionally not done** — that was built and
reverted at the user's request; see [DECISIONS.md](DECISIONS.md). The tag editor
is the fix, but it is manual by design: the library only improves as far as the
user actually tags it. "Fill from filename" makes that fast; it never fires on
its own.

### Cover art is untested on ogg and opus
Those carry pictures as base64 `METADATA_BLOCK_PICTURE`, which the fixture
generator cannot produce, so artwork coverage stops at mp3, flac and m4a. It may
work; nothing proves it.

### Backups are never pruned
Every file edited for the first time is copied whole into
`%APPDATA%\Resonance\tag-backups`. One copy per file, not per edit, so it cannot
grow without bound as you re-edit — but a library-wide retag doubles that
library's size on disk, and nothing surfaces or clears it yet.

### No queue persistence UI
The queue restores across restarts but cannot be saved as a playlist, and there
is no "clear queue" button.

### Windows only
`electron-builder.yml` targets `win` and **x64 only**. macOS/Linux would need
tray icon work, different window chrome handling, and the frameless decisions in
`windows/main.ts` revisited.

---

## Known limitations (won't fix / can't fix)

**WAV cannot carry non-ASCII tags — unless Resonance wrote them.** RIFF INFO
predates Unicode, so a CJK artist written by ffmpeg comes back mangled
(`Test Artist 紅蓮` reads as `Test Artist g4h.`). ID3v2, Vorbis
comments and MP4 atoms all round-trip correctly. A passing test documents this
so it isn't rediscovered as a bug. The tag editor sidesteps it: taglib writes an
**ID3v2.4 chunk into the WAV**, which music-metadata prefers, so a WAV retagged
through Resonance does round-trip Japanese.

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

**The mini-player's always-on-top is not guaranteed.** Windows declines a
topmost request from a process that is not in the foreground, so the mini-player
occasionally does not float. Measured at roughly two failures in eight launches
on a busy machine, on code predating the selection work — it is environmental,
not a regression. The app asks for it in the constructor and re-asserts on show;
the OS has the final say. Deliberately not asserted in the e2e suite, since a
test that fails a third of the time gets ignored rather than believed. **Check
by hand** when touching mini-player code.

**Closing the window does not quit the app.** Minimize-to-tray is on by default,
so ✕ hides to tray. Quit via the tray menu. This surprises people, including
during development — a running instance holds the single-instance lock.

---

## Test coverage notes

**Unit (271)** — queue state machine (exhaustive across shuffle × repeat ×
end-of-list), M3U parsing/writing, EQ presets and clamping, sleep timer,
grouping/sorting, filename→title repair, database schema and migrations,
generated fixture integrity, selection arithmetic, drag routing, tag
write/read/backup, tag-form merging, filename parsing.

**E2E (113)** — drives the real Electron app across 14 spec files. Highlights
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
- `desktop.spec.ts` "Settings persists" toggles the minimize-to-tray checkbox
  with `click({ force: true })`, not `uncheck()`. The checkbox is stable in
  isolation (measured: one rect, zero mutations over 2s), but a full-suite run
  occasionally jittered its launch — a neighbouring spec's Electron instance can
  disrupt global-shortcut registration and, with it, sub-frame stability. `force`
  fires the real click and real onChange without waiting on that stability.
- `tags.spec.ts` — **destructive**, so it runs against its own copies of the
  fixtures in `test-results/tag-media` and its own userData directory. Writing
  to the shared fixtures would rewrite the very tags `scan.spec.ts` asserts on,
  and the failure would surface over there instead of here. Includes a write to
  a 112 MB file mid-playback, with a byte-range request genuinely in flight.
- `drag.spec.ts` — drives real pointer drags. Also the **only** coverage of
  queue reordering as a gesture: that existed long before the drag work but was
  only ever exercised through the store, so consolidating the two `DndContext`s
  into one had no regression net where it could actually break.

**Not covered:** mini-player always-on-top (environment-dependent, see above), WMA playback, code-signed installs, multi-monitor DPI changes,
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
