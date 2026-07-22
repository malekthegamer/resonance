import { existsSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import { ensureFixtures, FIXTURE_DIR } from '../fixtures/gen-audio'

/**
 * Slice 9: the packaged build.
 *
 * A build that produces an .exe is not the same as a build that runs. Packaging
 * changes how paths resolve (asar, resourcesPath), so the tray icons, the
 * renderer bundle and the database can all work in development and fail here.
 * This drives the actual packaged binary.
 */

/*
 * Artifact names are derived from package.json, not hardcoded.
 *
 * They were pinned to 0.1.0 while the app was at 0.1.4, and `release/` still
 * held that old build — so these tests kept passing against a binary from
 * several versions earlier and reported the packaged build as verified. A stale
 * `release/` directory must fail loudly, which is what the version assertion at
 * the end of the launch test is for.
 */
const VERSION = JSON.parse(
  readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')
).version as string

const UNPACKED = resolve(process.cwd(), 'release', 'win-unpacked', 'Resonance.exe')
const INSTALLER = resolve(process.cwd(), 'release', `Resonance-${VERSION}-x64.exe`)
const PORTABLE = resolve(process.cwd(), 'release', `Resonance-${VERSION}-portable.exe`)

test.describe('packaged build', () => {
  test.skip(!existsSync(UNPACKED), 'run `npm run dist` first')

  test('produces an installer and a portable build', () => {
    for (const [label, path] of [
      ['installer', INSTALLER],
      ['portable', PORTABLE]
    ]) {
      expect(existsSync(path), `${label} should exist at ${path}`).toBe(true)
      const mb = statSync(path).size / 1048576
      // eslint-disable-next-line no-console
      console.log(`${label!.padEnd(10)} ${mb.toFixed(1)} MB  ${path}`)
      expect(mb).toBeGreaterThan(40)
    }
  })

  test('the packaged app launches, opens its window and reaches its database', async () => {
    const env = { ...process.env }
    delete env['ELECTRON_RUN_AS_NODE']

    const app = await electron.launch({
      executablePath: UNPACKED,
      args: [`--user-data-dir=${resolve(process.cwd(), 'test-results', 'packaged-userdata')}`],
      env: env as Record<string, string>
    })

    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')

    // The renderer bundle loaded from inside the asar.
    await expect(page.getByTestId('player-bar')).toBeVisible({ timeout: 20_000 })

    // node:sqlite works in the packaged runtime — this is the §A7 replacement
    // for better-sqlite3 and the whole reason there is no rebuild step.
    const info = await page.evaluate(() => window.resonance.library.dbInfo())
    expect(info.sqlite).toMatch(/^\d+\.\d+\.\d+$/)
    expect(info.schemaVersion).toBe(info.expectedSchemaVersion)
    expect(info.journalMode).toBe('wal')

    // Paths resolve differently once packaged; userData must still be ours.
    expect(info.path).toContain('packaged-userdata')

    const versions = await page.evaluate(() => window.resonance.getAppInfo())
    // eslint-disable-next-line no-console
    console.log(
      `\n=== PACKAGED APP ===\nname ${versions.name} v${versions.version}\n` +
        `electron ${versions.electron} · chromium ${versions.chrome} · node ${versions.node}\n` +
        `sqlite ${info.sqlite} · schema v${info.schemaVersion} · ${info.journalMode}\n`
    )
    expect(versions.name).toBe('Resonance')
    // The binary under test must be the one built from this source tree.
    expect(versions.version, 'release/ holds a stale build — rerun `npm run dist`').toBe(VERSION)

    /*
     * The tag editor's writer is an *externalized* dependency: electron-vite
     * leaves `require('node-taglib-sharp')` in the bundle, so it has to be
     * resolvable from inside the asar at runtime. Nothing in the unpackaged
     * suite can catch it being left out — it resolves fine from node_modules in
     * development and only fails once shipped.
     */
    ensureFixtures()
    await page.evaluate((dir) => window.resonance.library.scanPaths([dir]), FIXTURE_DIR)

    const tagRead = await page.evaluate(async () => {
      const tracks = await window.resonance.library.getTracks()
      // Specifically a tagged fixture: `tone-440-6db.wav` is deliberately bare
      // for the FFT tripwire, so reading it proves nothing about tag decoding.
      const target = tracks.find((t) => t.path.endsWith('fixture.mp3'))
      if (!target) return { scanned: tracks.length, found: false }
      const read = await window.resonance.tags.read([target.id])
      return {
        scanned: tracks.length,
        found: true,
        ok: read[0]?.ok === true,
        error: read[0]?.error,
        title: read[0]?.tags?.title,
        artist: read[0]?.tags?.artist
      }
    })
    expect(tagRead.scanned, 'the packaged app should have scanned the fixtures').toBeGreaterThan(0)
    expect(tagRead.found, 'fixture.mp3 should be in the packaged library').toBe(true)
    expect(tagRead.ok, `taglib failed inside the package: ${tagRead.error ?? ''}`).toBe(true)
    expect(tagRead.title).toBe('Resonance Test Tone')
    // Non-ASCII through taglib, decoded inside the asar.
    expect(tagRead.artist).toBe('Test Artist 紅蓮')

    await page.screenshot({ path: 'test-results/slice9-packaged.png' })
    await app.close()
  })
})
