# Resonance — working notes

Windows desktop music player. Electron + React + TypeScript. Shipped and in
daily use by its author.

**Read this first, then [docs/STATUS.md](docs/STATUS.md) for what's left to do.**
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) explains how it fits together and
[docs/DECISIONS.md](docs/DECISIONS.md) records why — including the mistakes,
which are usually the more useful half.

- **Repo:** https://github.com/malekthegamer/resonance
- **Current version:** 0.2.0 · **Tests:** 271 unit, 113 e2e, all passing
- **Users:** the author and friends, on Windows 11. Not a hypothetical audience —
  a regression means someone's music player breaks.

---

## Commands

```bash
npm run dev              # dev with HMR
npm test                 # Vitest — pure logic, ~0.5s
npm run test:e2e         # builds, then drives the real Electron app, ~60s
npm run typecheck        # tsc, blocking in CI
npm run dist             # installer + portable -> release/
npm run release -- patch # bump, tag, push; Actions builds and publishes
```

Always run `npm run typecheck` before pushing. It is a blocking CI step and it
has broken the release pipeline before.

---

## Environment landmines

These have each cost real debugging time. Check them before assuming a bug.

**`ELECTRON_RUN_AS_NODE` is set in some agent/editor environments.** Electron
then runs the entry file as plain Node: `require('electron')` resolves to the
npm shim, `app` is `undefined`, and it dies with a stack trace that looks like
an application bug. `tests/e2e/helpers.ts` strips it; anything else launching
Electron must too.

**Orphaned Electron processes block every launch.** Resonance holds a
single-instance lock, so a leftover process makes new instances quit instantly —
including test runs, which fail with `Target page, context or browser has been
closed`.

```powershell
Get-Process electron -ErrorAction SilentlyContinue | Stop-Process -Force
```

**Don't assume the app isn't running.** The author uses it daily. It minimises
to tray, so the window being closed does not mean the process is gone — which
also means it holds the single-instance lock and its database.

**`npm` cannot be spawned with `execFileSync` on Windows.** It is a `.cmd` shim
and Node refuses to launch `.bat`/`.cmd` without a shell (CVE-2024-27980). Do
the work in-process instead; `scripts/release.mjs` shows the pattern.

**A drag swallows the next click for 50 ms.** On drag start dnd-kit installs a
capturing `click` listener on `document` that calls `stopPropagation`, and tears
it down on a `setTimeout(…, 50)` after the drop — see `AbstractPointerSensor`
in `@dnd-kit/core`. It exists to eat the click the drag itself generates. A
person moving a mouse never notices; Playwright clicks well inside the window,
so a click issued straight after a drag silently does nothing and looks like a
broken button. `tests/e2e/drag.spec.ts` waits it out.

**Be careful writing JS strings via shell heredocs.** A literal NUL byte once
ended up in `grouping.ts` where a space belonged. It renders as blank in every
editor, defeated three separate string replacements, and silently broke album
grouping. If a replacement "cannot find" a string that is visibly there, dump
the character codes.

---

## Ground rules for changes

**Verify by running, not by reasoning.** Every significant bug in this project
was found by executing something and looking at the output — several were
invisible to inspection. For UI work, take a screenshot and actually look at it;
"it compiles" has been wrong here more than once.

**Tests must not depend on this machine.** Five e2e tests once asserted against
the author's personal `~/Music` folder and passed locally while failing on CI.
Fixtures are generated (`tests/fixtures/gen-audio.ts`). To reproduce CI locally,
point `USERPROFILE` at an empty directory.

**Never guess metadata.** Filename inference was built, shipped, and reverted at
the user's request — it produced plausible but unverifiable groupings. An
untagged library is served by explicit playlists, not invented structure. See
[docs/DECISIONS.md](docs/DECISIONS.md).

**Migrations, not rescans, fix existing libraries.** The scanner skips files
whose mtime is unchanged, so bad data already in the database survives a rescan
indefinitely. `src/main/db/schema.ts` migration 3 is the worked example.

**Don't break the user's data.** Playlists, play counts and `date_added` survive
rescans and uninstalls by design. `%APPDATA%\Resonance` is theirs.
