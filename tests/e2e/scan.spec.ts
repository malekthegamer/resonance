import { homedir } from 'node:os'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { ensureFixtures, FIXTURE_DIR, FIXTURE_TAGS } from '../fixtures/gen-audio'
import { launchApp } from './helpers'

/**
 * Slice 2 exit criteria (plan §A3): a real scan over the user's actual MP3
 * library plus the generated fixtures, reporting per-format counts and proving
 * tags survive ID3, Vorbis comments and MP4 atoms.
 */

const USER_MUSIC = join(homedir(), 'Music')

let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  ensureFixtures()
  ;({ app, page } = await launchApp())
})

test.afterAll(async () => {
  await app?.close()
})

test('scans the fixture folder and the real library, reporting per-format counts', async () => {
  const roots = [FIXTURE_DIR]
  if (existsSync(USER_MUSIC)) roots.push(USER_MUSIC)

  const started = Date.now()
  const progress = await page.evaluate(
    (paths) => window.resonance.library.scanPaths(paths),
    roots
  )
  const wallMs = Date.now() - started

  const stats = await page.evaluate(() => window.resonance.library.stats())

  // eslint-disable-next-line no-console
  console.log(
    `\n=== SCAN RESULT ===\n` +
      `roots        : ${roots.join(', ')}\n` +
      `files found  : ${progress.filesFound}\n` +
      `processed    : ${progress.filesProcessed}\n` +
      `inserted     : ${progress.inserted}   updated: ${progress.updated}   ` +
      `skipped: ${progress.skipped}   errors: ${progress.errors}\n` +
      `scan elapsed : ${progress.elapsedMs} ms (wall ${wallMs} ms)\n` +
      `by format    : ${JSON.stringify(stats.byFormat)}\n` +
      `library total: ${stats.trackCount} tracks\n`
  )

  expect(progress.phase).toBe('done')
  expect(progress.filesFound).toBeGreaterThan(0)
  expect(stats.trackCount).toBeGreaterThan(0)

  // §A3 coverage. Every one of these is a generated fixture, so absence means a
  // real parse failure rather than a missing file.
  for (const format of ['mp3', 'flac', 'wav', 'm4a', 'ogg', 'opus']) {
    expect(stats.byFormat[format] ?? 0, `expected at least one ${format} track`).toBeGreaterThan(0)
  }
})

test('tags round-trip through all three tag systems into the database', async () => {
  const hits = await page.evaluate(
    (title) => window.resonance.library.search(title),
    FIXTURE_TAGS.title
  )

  // One per encoded fixture that carries tags (flac, m4a, ogg, opus, mp3, wav).
  expect(hits.length).toBeGreaterThanOrEqual(5)

  const formats = new Set(hits.map((t) => t.format))
  for (const f of ['flac', 'm4a', 'ogg', 'opus', 'mp3']) {
    expect(formats.has(f), `${f} fixture should be findable by its title tag`).toBe(true)
  }

  for (const hit of hits) {
    expect(hit.title).toBe(FIXTURE_TAGS.title)
    expect(hit.album).toBe(FIXTURE_TAGS.album)
    expect(hit.duration).toBeGreaterThan(4)
  }

  // Non-ASCII must survive the tag reader, the worker thread boundary, SQLite,
  // and IPC unchanged — but only for tag systems that can represent it. WAV is
  // excluded deliberately; see the next test.
  for (const hit of hits.filter((t) => t.format !== 'wav')) {
    expect(hit.artist, `${hit.format} should preserve non-ASCII`).toBe(FIXTURE_TAGS.artist)
  }
})

test('known limitation: WAV cannot carry non-ASCII tags', async () => {
  // RIFF INFO chunks predate Unicode and are read through a code page, so the
  // CJK artist comes back mangled. This is a property of the WAV format, not of
  // Resonance — asserted here so it stays a characterized limitation rather than
  // resurfacing later as a mystery bug report.
  const hits = await page.evaluate(
    (title) => window.resonance.library.search(title),
    FIXTURE_TAGS.title
  )
  const wav = hits.find((t) => t.format === 'wav')
  expect(wav, 'the WAV fixture should still be scanned and searchable').toBeTruthy()

  // Everything ASCII survives; only the non-ASCII portion is lost.
  expect(wav!.title).toBe(FIXTURE_TAGS.title)
  expect(wav!.album).toBe(FIXTURE_TAGS.album)
  expect(wav!.artist).toContain('Test Artist')
  expect(wav!.artist).not.toBe(FIXTURE_TAGS.artist)
})

test('embedded artwork is extracted, deduplicated, and served over resonance-art://', async () => {
  const tracks = await page.evaluate(() => window.resonance.library.getTracks())
  const withArt = tracks.filter((t) => t.artRef)
  expect(withArt.length).toBeGreaterThan(0)

  // Content-addressed: the flac/m4a/mp3 fixtures embed the identical cover, so
  // they must share one cache entry rather than storing three copies.
  const fixtureArt = new Set(
    withArt.filter((t) => t.title === FIXTURE_TAGS.title).map((t) => t.artRef)
  )
  expect(fixtureArt.size).toBe(1)

  // Fetch it through the real protocol handler from inside the renderer. This is
  // what proves the privileged-scheme registration and the img-src CSP entry are
  // both correct — either being wrong fails silently in normal use.
  const ref = [...fixtureArt][0]!
  const result = await page.evaluate(async (artRef) => {
    const url = `resonance-art://art/${artRef.replace(/\\/g, '/')}`
    const res = await fetch(url)
    const buf = await res.arrayBuffer()
    return { ok: res.ok, status: res.status, bytes: buf.byteLength, type: res.headers.get('content-type') }
  }, ref)

  expect(result.ok).toBe(true)
  expect(result.bytes).toBeGreaterThan(100)
})

test('the art protocol refuses path traversal', async () => {
  // The ref reaches the handler from the database, but the handler is the app's
  // file-serving boundary and must not trust its input.
  const status = await page.evaluate(async () => {
    const res = await fetch('resonance-art://art/../../../../Windows/win.ini')
    return res.status
  })
  expect(status).toBe(404)
})

test('a rescan skips unchanged files instead of reparsing them', async () => {
  const again = await page.evaluate(
    (paths) => window.resonance.library.scanPaths(paths),
    [FIXTURE_DIR]
  )

  // Everything was just scanned and nothing changed on disk, so the expensive
  // parse must be skipped entirely — this is what keeps rescans cheap.
  expect(again.skipped).toBeGreaterThan(0)
  expect(again.inserted).toBe(0)
})
