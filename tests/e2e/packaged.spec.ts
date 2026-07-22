import { existsSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

/**
 * Slice 9: the packaged build.
 *
 * A build that produces an .exe is not the same as a build that runs. Packaging
 * changes how paths resolve (asar, resourcesPath), so the tray icons, the
 * renderer bundle and the database can all work in development and fail here.
 * This drives the actual packaged binary.
 */

const UNPACKED = resolve(process.cwd(), 'release', 'win-unpacked', 'Resonance.exe')
const INSTALLER = resolve(process.cwd(), 'release', 'Resonance-0.1.0-x64.exe')
const PORTABLE = resolve(process.cwd(), 'release', 'Resonance-0.1.0-portable.exe')

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

    await page.screenshot({ path: 'test-results/slice9-packaged.png' })
    await app.close()
  })
})
