import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { BULK_TERM, ensureBulkFixtures, ensureFixtures, FIXTURE_DIR } from '../fixtures/gen-audio'
import { launchApp } from './helpers'

/**
 * Regression tests for two reported bugs:
 *
 *  1. Sidebar buttons "almost unclickable", and completely dead while searching.
 *     The clicks always registered — `setView` did not clear the search or the
 *     open playlist, and the content area only renders a grid when both are
 *     empty, so nothing visibly changed.
 *
 *  2. Rename playlist did nothing. It used window.prompt(), which Electron does
 *     not implement; the call threw and was swallowed.
 */

let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  ensureFixtures()
  ensureBulkFixtures()
  ;({ app, page } = await launchApp())

  const roots = [FIXTURE_DIR]
  const music = join(homedir(), 'Music')
  if (existsSync(music)) roots.push(music)
  await page.evaluate((paths) => window.resonance.library.scanPaths(paths), roots)
  await page.reload()
  await page.waitForSelector('[data-testid="track-row"]')
})

test.afterAll(async () => {
  await app?.close()
})

test('library sections respond while a search is active', async () => {
  await page.getByTestId('search').fill(BULK_TERM)
  await expect(page.getByTestId('view-title')).toContainText('Search')

  // The reported symptom: clicking Albums during a search appeared to do nothing.
  await page.getByTestId('nav-albums').click()
  await expect(page.getByTestId('album-grid')).toBeVisible()
  await expect(page.getByTestId('view-title')).toHaveText('Albums')

  // The search box must clear too, or the next keystroke resurrects the search.
  await expect(page.getByTestId('search')).toHaveValue('')

  await page.getByTestId('nav-artists').click()
  await expect(page.getByTestId('artist-grid')).toBeVisible()

  await page.getByTestId('nav-genres').click()
  await expect(page.getByTestId('genre-grid')).toBeVisible()

  await page.getByTestId('nav-songs').click()
  await expect(page.getByTestId('track-table')).toBeVisible()
  await expect(page.getByTestId('view-title')).toHaveText('Songs')
})

test('every sidebar section switches on a single click', async () => {
  // "Almost unclickable" — each one must work first time, every time.
  for (const [id, expected] of [
    ['nav-albums', 'Albums'],
    ['nav-artists', 'Artists'],
    ['nav-genres', 'Genres'],
    ['nav-recent', 'Recently Added'],
    ['nav-songs', 'Songs']
  ] as const) {
    await page.getByTestId(id).click()
    await expect(page.getByTestId('view-title'), `${id} should switch view`).toHaveText(expected)
  }
})

test('library sections respond while a playlist is open', async () => {
  await page.getByTestId('new-playlist').click()
  await page.getByTestId('playlist-name-input').fill('Nav Test')
  await page.getByTestId('playlist-name-input').press('Enter')

  await page.evaluate(async () => {
    const lists = await window.resonance.playlists.list()
    const id = lists.find((p) => p.name === 'Nav Test')!.id
    const tracks = (await window.resonance.library.getTracks()).slice(0, 3)
    await window.resonance.playlists.addTracks(id, tracks.map((t) => t.id))
  })

  await page.getByTestId('playlist-item').filter({ hasText: 'Nav Test' }).click()
  await expect(page.getByTestId('view-title')).toHaveText('Nav Test')

  // The second instance of the same bug: an open playlist also blocked the grid.
  await page.getByTestId('nav-albums').click()
  await expect(page.getByTestId('album-grid')).toBeVisible()
  await expect(page.getByTestId('view-title')).toHaveText('Albums')
})

test('drilling into an album still works and Back returns', async () => {
  await page.getByTestId('nav-albums').click()
  await page.getByTestId('album-grid').locator('button').first().click()
  await expect(page.getByTestId('track-table')).toBeVisible()

  await page.getByTestId('back').click()
  await expect(page.getByTestId('album-grid')).toBeVisible()
})

test('a playlist can be renamed from the context menu', async () => {
  await page.getByTestId('nav-songs').click()

  const item = page.getByTestId('playlist-item').filter({ hasText: 'Nav Test' })
  await item.click({ button: 'right' })
  await page.getByTestId('context-menu').getByRole('menuitem', { name: 'Rename' }).click()

  const input = page.getByTestId('playlist-rename-input')
  await expect(input, 'rename must open an editable field').toBeVisible()
  // It should be seeded with the current name, not empty.
  await expect(input).toHaveValue('Nav Test')

  await input.fill('Renamed Playlist')
  await input.press('Enter')

  await expect(page.getByTestId('playlist-item').filter({ hasText: 'Renamed Playlist' })).toBeVisible()

  // And it must actually persist, not just change the label.
  const persisted = await page.evaluate(() => window.resonance.playlists.list())
  expect(persisted.some((p) => p.name === 'Renamed Playlist')).toBe(true)
  expect(persisted.some((p) => p.name === 'Nav Test')).toBe(false)
})

test('renaming can be cancelled with Escape', async () => {
  const item = page.getByTestId('playlist-item').filter({ hasText: 'Renamed Playlist' })
  await item.dblclick()

  const input = page.getByTestId('playlist-rename-input')
  await expect(input).toBeVisible()
  await input.fill('Should Not Stick')
  await input.press('Escape')

  await expect(page.getByTestId('playlist-item').filter({ hasText: 'Renamed Playlist' })).toBeVisible()
  const lists = await page.evaluate(() => window.resonance.playlists.list())
  expect(lists.some((p) => p.name === 'Should Not Stick')).toBe(false)
})

test('an empty rename keeps the old name rather than blanking it', async () => {
  await page.getByTestId('playlist-item').filter({ hasText: 'Renamed Playlist' }).dblclick()
  const input = page.getByTestId('playlist-rename-input')
  await input.fill('   ')
  await input.press('Enter')

  const lists = await page.evaluate(() => window.resonance.playlists.list())
  expect(lists.some((p) => p.name === 'Renamed Playlist')).toBe(true)
})

test('albums, artists and genres are a single Unknown bucket again', async () => {
  // Inference was reverted: the app no longer guesses structure it cannot verify.
  const tracks = await page.evaluate(() => window.resonance.library.getTracks())
  // Bulk fixtures are untagged, so they exercise the Unknown-bucket behaviour
  // on any machine.
  const real = tracks.filter((t) => t.path.includes('bulk'))

  for (const t of real) {
    expect(t.album, `${t.title} should have no guessed album`).toBe('')
    expect(t.genre, `${t.title} should have no guessed genre`).toBe('')
  }

  // Titles keep the full filename, which is how an untagged library is browsed.
  const bulk = tracks.find((t) => t.path.includes('bulk'))
  if (bulk) expect(bulk.title).toContain('Bulktrack')
})

test('searching a filename term still finds tracks', async () => {
  // This regressed under inference, which stripped words out of titles. Uses a
  // generated fixture term so it holds on any machine, not just one with a
  // particular music collection.
  const hits = await page.evaluate((term) => window.resonance.library.search(term), BULK_TERM)
  expect(hits.length, 'searching a filename term must find its tracks').toBeGreaterThan(0)
})

test('library sections respond while Now Playing is open', async () => {
  await page.evaluate(async () => {
    const tracks = await window.resonance.library.getTracks()
    const player = (window as never as {
      __resonancePlayer: { playTracks(t: unknown[], i: number): Promise<void> }
    }).__resonancePlayer
    await player.playTracks([tracks[0]!], 0)
  })

  await page.getByTestId('open-now-playing').click()
  await expect(page.getByTestId('now-playing')).toBeVisible()

  // Third instance of the same bug: Now Playing covers the content area, so
  // leaving it open made the sidebar look dead again.
  await page.getByTestId('nav-albums').click()
  await expect(page.getByTestId('now-playing')).toBeHidden()
  await expect(page.getByTestId('album-grid')).toBeVisible()
})

test('deleting a playlist asks first and can be cancelled', async () => {
  await page.getByTestId('nav-songs').click()
  await page.getByTestId('new-playlist').click()
  await page.getByTestId('playlist-name-input').fill('Delete Me')
  await page.getByTestId('playlist-name-input').press('Enter')
  await expect(page.getByTestId('playlist-item').filter({ hasText: 'Delete Me' })).toBeVisible()

  await page.getByTestId('playlist-item').filter({ hasText: 'Delete Me' }).click({ button: 'right' })
  await page.getByTestId('context-menu').getByRole('menuitem', { name: 'Delete playlist' }).click()

  // Deletion is irreversible, so a misclick must not be enough.
  await expect(page.getByTestId('confirm-dialog')).toBeVisible()
  await page.getByTestId('confirm-cancel').click()
  await expect(page.getByTestId('playlist-item').filter({ hasText: 'Delete Me' })).toBeVisible()

  await page.getByTestId('playlist-item').filter({ hasText: 'Delete Me' }).click({ button: 'right' })
  await page.getByTestId('context-menu').getByRole('menuitem', { name: 'Delete playlist' }).click()
  await page.getByTestId('confirm-ok').click()
  await expect(page.getByTestId('playlist-item').filter({ hasText: 'Delete Me' })).toHaveCount(0)
})

test('search stays responsive and lands on the final query', async () => {
  // Debounced search must not leave results for an intermediate prefix.
  await page.getByTestId('search').pressSequentially(BULK_TERM, { delay: 30 })
  await expect(page.getByTestId('view-title')).toContainText(BULK_TERM)
  await expect.poll(async () => page.getByTestId('track-row').count()).toBeGreaterThan(0)

  await page.getByTestId('nav-songs').click()
  await expect(page.getByTestId('search')).toHaveValue('')
})
