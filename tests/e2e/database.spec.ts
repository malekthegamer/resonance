import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { launchApp } from './helpers'

/**
 * Slice 1 exit criterion: the library database must be proven to work *inside
 * Electron*, not merely under plain Node in a unit test. The ABI/runtime question
 * ("does SQLite actually exist in this process?") is only meaningful here.
 */

let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  ;({ app, page } = await launchApp())
})

test.afterAll(async () => {
  await app?.close()
})

test('the database is open, migrated, and in WAL mode inside Electron', async () => {
  const info = await page.evaluate(() => window.resonance.library.dbInfo())

  expect(info.sqlite).toMatch(/^\d+\.\d+\.\d+$/)
  expect(info.schemaVersion).toBe(info.expectedSchemaVersion)

  // WAL matters: the scanner writes while the UI reads. Without it, a large
  // scan blocks every query and the library UI appears frozen.
  expect(info.journalMode).toBe('wal')

  // A real file on disk in userData, not an in-memory database that silently
  // discards the library on quit.
  expect(info.path).toMatch(/library\.db$/)

  // Under a userData directory named for the app. Electron defaults this to
  // "Electron" in development, which would put the dev library somewhere
  // different from the packaged one — and relocating it later orphans a real
  // user's library.
  expect(info.path).toContain('Resonance')
})

test('every table the app depends on exists in the real app database', async () => {
  const info = await page.evaluate(() => window.resonance.library.dbInfo())
  for (const table of ['tracks', 'playlists', 'playlist_tracks', 'watched_folders']) {
    expect(info.tables).toContain(table)
  }
})

test('the schema survives a restart — migrations are idempotent on a real file', async () => {
  const before = await page.evaluate(() => window.resonance.library.dbInfo())
  await app.close()

  const relaunched = await launchApp()
  const after = await relaunched.page.evaluate(() => window.resonance.library.dbInfo())
  await relaunched.app.close()

  expect(after.schemaVersion).toBe(before.schemaVersion)
  expect(after.tables.sort()).toEqual(before.tables.sort())

  // Re-open for the remaining suite ordering; beforeAll already ran.
  ;({ app, page } = await launchApp())
})
