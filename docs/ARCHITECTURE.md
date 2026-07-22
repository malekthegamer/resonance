# Architecture

How Resonance fits together, and the constraints that shaped it. For *why*
particular calls were made, see [DECISIONS.md](DECISIONS.md).

```
shared/          types + IPC channel names, imported by all three processes
src/main/        SQLite, filesystem, scanning, tray, shortcuts, windows, protocols
src/preload/     the only main<->renderer bridge
src/renderer/    all UI, and the Web Audio playback graph
tests/unit/      Vitest — pure logic, no Electron
tests/e2e/       Playwright — drives the real packaged/built app
```

---

## Process model

One rule: **the renderer never touches the filesystem or the database.** It asks
main over IPC.

`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. The preload
exposes *named capabilities* — `window.resonance.library.getTracks()` — never a
generic `invoke(channel, ...)` passthrough, which would hand a compromised
renderer the entire main-process API. An e2e test asserts `require`, `process`
and `ipcRenderer` are all absent from the renderer.

### Windows

| Window | Owns | Notes |
|---|---|---|
| Main (`windows/main.ts`) | The audio graph, all UI | Frameless; owns window-state persistence |
| Mini-player (`windows/mini.ts`) | Nothing | Always-on-top remote control |

The mini-player deliberately has **no AudioContext**. It renders state pushed
from the main window and sends commands back through main. Two audio graphs
would mean genuine double playback. `main.tsx` routes on `?window=mini` and
mounts a different tree; an e2e test asserts the mini window has no engine.

---

## Media never travels as a file path

Two custom protocols, registered **before `app.whenReady()`**:

```
resonance-media://track/<id>       audio
resonance-art://art/<sha-sharded>  artwork
```

Both accept **opaque identifiers only**. A track id is resolved to a real path
through the database; an art ref is pattern-matched and joined under the cache
directory. A compromised renderer cannot read arbitrary files by asking for
them, and path traversal is rejected (tested).

Three things are required together for audio to work at all, and omitting any
one produces **silence with no error**:

1. `corsEnabled: true` in the privileged scheme registration
2. `Access-Control-Allow-Origin: *` on every media response
3. `crossOrigin = 'anonymous'` on the audio decks, set **before** `src`

`src/main/protocol.ts` implements byte-range serving explicitly — `Accept-Ranges`,
206 responses with `Content-Range`, and a correct `Content-Length`. Without
`Content-Length`, Chromium cannot compute duration: `el.duration` stays
`Infinity`, the seek bar has no scale, and seeking is impossible.

---

## Audio engine (`renderer/src/audio/engine.ts`)

```
deckA <audio> -> MediaElementSource -> gainA ┐
                                             ├-> 10x BiquadFilter -> Analyser -> master -> out
deckB <audio> -> MediaElementSource -> gainB ┘
```

**Two decks, created once, never recreated.** `createMediaElementSource()` may
be called only once per element for the lifetime of the page; a second call
kills audio silently. Decks are reused by swapping `src`.

Two decks also give crossfade and next-track preload from one topology. The
analyser sits *after* the EQ and *after* the mix, so the visualizer shows what is
actually heard and a crossfade is visible in it.

**Advance guarding.** Every load increments a monotonic `generation`. An `ended`
event carrying a stale generation is dropped, which is what stops a track that
fires `ended` twice from skipping two tracks.

**AudioParam writes go through `applyParam()`**, which sets `.value` directly
when the context is suspended and ramps when it is running. `setTargetAtTime`
only advances with the context clock, so EQ and volume changes made while
nothing was playing used to be silently discarded.

### Queue state machine (`renderer/src/core/queue.ts`)

Pure, no React, no audio — because this is where playback bugs live. Shuffle is
an explicit permutation (`order[]`), not a random pick per advance, so every
track plays once before repeating. `next(state, auto)` distinguishes a track
ending naturally from the user pressing next: under repeat-one the former
restarts and the latter escapes. Unit-tested exhaustively across every
shuffle x repeat x end-of-list combination.

---

## Database (`src/main/db/`)

**`node:sqlite`, not `better-sqlite3`** — see [DECISIONS.md](DECISIONS.md). The
driver is isolated behind `db/index.ts`; swapping back is one file.

| File | Role |
|---|---|
| `index.ts` | Driver seam, migrations, `repairInferredTitles` |
| `schema.ts` | DDL + migration list. **Never edit a shipped migration** |
| `open.ts` | Electron-aware singleton (`app.getPath('userData')`) |
| `tracks.ts` | Track queries, upsert, FTS search |
| `playlists.ts` | Playlist CRUD, ordered membership, path index |

**Albums and artists are not normalized into tables.** They are derived with
`GROUP BY` over indexed columns. The library is rescanned wholesale; normalized
rows would need reconciling every time, and stale orphans after a re-tag are how
"ghost albums" appear and never leave.

**Playlist positions are rewritten as a block** inside one transaction.
`(playlist_id, position)` is the primary key, so an incremental shuffle collides
with itself partway through a reorder.

**FTS5** over title/artist/album, kept in sync by insert/update/delete triggers.
Tests cover the trigger sync specifically, because a broken trigger leaves search
silently stale while the library still looks correct.

**Rescans never overwrite `date_added`, `play_count` or `last_played`.**

---

## Scanning (`src/main/scan/`)

Runs in a **worker thread**. Metadata parsing is CPU-bound; on main it would
block window painting, IPC and the tray for the whole scan. Main only performs
batched insert transactions. Progress is throttled to ~120ms rather than emitted
per file — a 50k-track scan would otherwise fire 50k IPC messages.

Artwork is written to a **content-addressed cache** (SHA-256 of the image bytes)
*inside the worker*, so multi-megabyte buffers never cross the thread boundary
and a 20-track album with identical covers costs one file.

`watcher.ts` (chokidar) debounces filesystem events — copying an album fires
dozens of `add` events — and waits for writes to settle so a file mid-copy is
not parsed as truncated. New files go through the ordinary scanner so there is
no second code path to drift.

**Deleted files are marked `available = 0`, never removed.** A temporarily
disconnected drive must not destroy playlists and play counts.

---

## Design system

The **blue→purple gradient (`#4f7cff` → `#9b5cff`) is a fixed identity token**.
It is used for the player bar, active row, progress fill, play button, EQ fills
and focus states, and is **never** derived from artwork.

Album art tints exactly one surface: a clamped wash behind the Now Playing
artwork (`core/art.ts`, saturation ≤ 0.55, lightness 0.28–0.55). E2E tests load
deliberately extreme covers — saturated red and saturated teal — and assert the
identity tokens are untouched and the player bar carries no art-derived gradient.

Icons are inline SVG inheriting `currentColor`. Emoji were tried first and
rendered in full colour on Windows (the repeat symbol was a blue box).

Missing artwork falls back to a **deterministic gradient** derived from the album
name, hue-constrained to 200°–330° so the grid still reads as one system. This
is not a corner case: the author's library has no embedded art at all.
