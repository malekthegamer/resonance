# Decisions

Why Resonance is the way it is. Weighted toward the choices that were *wrong
first* — those are the ones worth not repeating.

---

## `node:sqlite` instead of `better-sqlite3`

**The spec called for `better-sqlite3`. It cannot be built on the target
machine.** Visual Studio 2022 registers the VC++ components but ships no
`MSBuild.exe`, so no native module compiles at all.

The diagnosis is worth recording because two plausible theories were wrong
first: that Git Bash was dropping `%ProgramFiles(x86)%` (it wasn't), and that
the sandbox was blocking node-gyp's PowerShell probe (it failed identically
outside). The real cause: node-gyp looks for the package
`Microsoft.VisualStudio.VC.MSBuild.Base` while VS 17.14 registers it as
`...VC.MSBuild.v170.Base`, so the check misses and falls through to a hardcoded
path that is empty.

`node:sqlite` is built into Electron's bundled Node. Verified in both dev and
the packaged build: SQLite 3.53.1, prepared statements, bulk transactions, named
parameters, WAL, and FTS5.

**Consequences:** zero native modules, so `npmRebuild` is off and packaging is
far more reliable. There is no rebuild step to document, which changed the
wording of one acceptance criterion. FTS5 came free and global search uses a
real full-text index rather than `LIKE` scans.

`npm run probe:sqlite` reproduces the verification.

---

## Filename inference: built, shipped, reverted

The author's library has **zero tags** — no title, artist, album or genre on any
of 53 files. Albums/Artists/Genres rendered as a single "Unknown" bucket.

Inference was built: series → album, song → title, `X by Y` → artist, episode
marker → genre. It worked, organising 43 of 53 tracks into 8 series albums, and
it was **reverted at the user's request** in favour of explicit playlists.

The revert taught more than the feature:

- **A rescan does not undo bad data.** The scanner skips files whose mtime is
  unchanged, so inferred values would have survived indefinitely. It needed
  migration 3.
- **Inference had shortened titles**, stripping the series name — so searching
  "titan" returned *zero results*. `repairInferredTitles()` restores the full
  filename, because for an untagged library the filename *is* the track's
  identity.
- **`album_artist` carried guessed data with no flag of its own**, because it
  fell back to the inferred artist. The first version of the migration missed it.

The lesson: don't invent structure you cannot verify, and when reverting, hunt
for the derived fields the original change touched indirectly.

**The parser is back, as a button.** `core/fillFromFilename.ts` is that same
code, and the difference is the whole point: it now only ever fills a form the
user is looking at, and nothing reaches a file until they read it and press
Save. The objection was never that the guesses were bad — it was that the app
made them silently. A suggestion the user reviews is the opposite of an
invention made behind their back, so the parser is free to guess and free to be
wrong. An e2e test asserts that opening the editor, pressing "Fill from
filename" and then cancelling leaves the file byte-identical.

What did *not* come back is the canonicalization pass that merged "ReZero" and
"Re ZERO - Starting Life in Another World" into one album. That needed a global
view of the library and ran without asking; there is no version of it that fits
inside a per-file review step.

---

## Tags are written into the files, with a one-time backup

The honest answer to an untagged library is to let the user set real metadata,
not to guess it — see the revert above. So the tag editor writes genuine
ID3/Vorbis/MP4 tags that other players can read, rather than keeping Resonance's
own opinion in its database.

**`node-taglib-sharp` writes; `music-metadata` still reads.** music-metadata has
no write API. taglib was picked over the alternatives because its dependencies
are pure JavaScript, so the zero-native-modules guarantee that makes packaging
reliable here survives. Before a line of the module was written, a probe checked
the premise that actually mattered — that the two libraries agree — by writing
with taglib and reading back with music-metadata across all six formats,
non-ASCII included. They do.

**Backups happen once per file, ever — not once per edit.** The thing worth
preserving is the state the user arrived with. Re-copying on every save would
overwrite that pristine original with an already-edited one after a single
further edit, quietly destroying the only thing the mechanism exists to protect.
The directory is created with a non-recursive `mkdir`, whose EEXIST makes the
"have I backed this up already?" check an atomic test-and-set rather than a
racy `existsSync`.

**The database is updated by rescanning the written files, not by patching
rows.** Writing tags changes the file's mtime, which is exactly what lets the
scanner's mtime-skip pass them through — so the tracks table, the FTS index and
the art cache all update through the one path already known to work. No second
write path to keep in sync.

**Two risks the plan flagged turned out differently than expected.** Writing to
a file Chromium is streaming was predicted to fail with EBUSY; measured, it
succeeds — including a seek into the middle of a 112 MB file with a byte-range
request in flight. The mitigation (pausing and unloading the deck) was therefore
not built. The error path still exists and reports in plain language, because
"measured to work on this machine" is not the same as "cannot fail".

And a small bonus: **taglib fixes the WAV limitation** documented in STATUS.md.
ffmpeg writes WAV tags as RIFF INFO, which predates Unicode and mangles
non-ASCII. taglib writes an ID3v2.4 chunk into the WAV alongside it, and
music-metadata prefers that — so a WAV *retagged through Resonance* round-trips
Japanese correctly even though the same file as generated does not.

---

## Frameless window, Snap Layouts forfeited

Chosen for edge-to-edge glass. The Snap Layouts hover flyout attaches to the
native maximize button and cannot be recovered — an early plan claimed it would
be "verified by screenshot", which was incoherent, since a hover interaction on a
button that doesn't exist cannot be photographed.

Compensating gestures were added: double-click-to-maximize and drag-to-top.
Win+Arrow and Win+Z were never affected.

---

## The mini-player owns no audio

It is a remote control. Two windows with their own `AudioContext` would produce
genuine double playback — obvious in hindsight, miserable to retrofit. An e2e
test asserts the mini window has no engine object at all.

This forced a small piece of design: the mini-player receives no state until
something changes, so opening it showed "Nothing playing" indefinitely for a
paused track. Main now asks the audio-owning window to re-publish on open.

---

## Tests generate their own fixtures

Originally the suite asserted against the author's `~/Music`. It passed locally
and **failed the first real CI run with five errors** — searching for "titan",
needing a library big enough for virtualization to be observable, and asserting
a userData path that only held when no `--user-data-dir` was passed.

`tests/fixtures/gen-audio.ts` now synthesizes everything: tagged FLAC/M4A/OGG/
Opus/WAV/MP3 from a tone via `ffmpeg-static`, 40 small bulk tracks for
virtualization and search, and a ~112 MB WAV for range-seek.

**Size is load-bearing on that last one.** Below a few MB Chromium buffers the
whole resource and never issues a Range request, so a small-file seek test
passes without exercising anything.

---

## The FFT silence tripwire

The central risk in this app is playback that *looks* healthy while producing
silence: a cross-origin media element that isn't CORS-approved feeds the
analyser nothing, yet `currentTime` still advances and the UI looks fine.

The tripwire measures analyser output over ~500ms with a paused negative
control. Both details matter, and the first version had neither right:

- It averaged all 1024 FFT bins. A 440 Hz sine puts its energy in one or two, so
  a full-strength tone measured **1.73** and looked like silence. Peak bin
  separates cleanly: **255 playing vs 0 paused**.
- A single frame is not evidence — it can land on a genuinely quiet moment
  (false alarm) or catch a transient on a broken graph (false pass, the
  dangerous direction).

---

## Releases are published explicitly, not by electron-builder

`electron-builder --publish always` created **two draft releases for the same
tag** — the nsis and portable targets each raced to create one, splitting the
assets. And drafts are invisible both to the public *and to electron-updater*,
so a green build produced a page nobody could download from and an update path
that could never fire.

The workflow now builds with `--publish never` and runs one explicit
`gh release create` with all three assets. `latest.yml` is not optional:
without it, installed copies cannot discover updates.

---

## Smaller calls worth knowing

**Session restores paused.** Launching straight into unexpected audio is
startling; the spec asked for the session to be restored, not resumed.

**Crossfade applies only to natural track ends.** Crossfading a manual skip
makes the button feel laggy — the user asked for the next track *now*.

**Crossfade defaults to off.** It changes how every transition sounds and should
be opted into.

**Uninstall leaves `%APPDATA%\Resonance`.** Deleting someone's playlists and play
counts because they updated the app would be hostile.

**Deleting a playlist confirms first**, with focus on Cancel. It is irreversible.

**Navigation clears search, open playlist and Now Playing together.** Three
separate bugs had the same shape: the sidebar looked completely unresponsive
because the content area only renders a grid when all of those are empty. The
clicks always registered — nothing visibly changed. If a new "mode" is added
that occupies the content area, it must be cleared in `navigateTo` too.

**`window.prompt()` does not exist in Electron.** It throws `prompt() is not
supported`. Playlist rename used it and silently did nothing; it is now inline
editing.
