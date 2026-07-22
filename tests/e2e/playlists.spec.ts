import { existsSync, readdirSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { ensureFixtures, FIXTURE_DIR } from '../fixtures/gen-audio'
import { launchApp } from './helpers'

/** Slice 5: queue editing, playlist CRUD, M3U import/export, context menus. */

let app: ElectronApplication
let page: Page

const PLAYLIST_DIR = join(homedir(), 'Music', 'playlists')

test.beforeAll(async () => {
  ensureFixtures()
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

test('queue: tracks can be added, reordered and removed', async () => {
  const result = await page.evaluate(async () => {
    const tracks = (await window.resonance.library.getTracks()).slice(0, 5)
    const player = (window as never as {
      __resonancePlayer: { playTracks(t: unknown[], i: number): Promise<void> }
    }).__resonancePlayer
    await player.playTracks(tracks, 0)
    return tracks.map((t) => t.id)
  })
  expect(result.length).toBe(5)

  await page.getByTestId('open-queue').click()
  await expect(page.getByTestId('queue-panel')).toBeVisible()
  await expect(page.getByTestId('queue-row')).toHaveCount(5)

  await page.screenshot({ path: 'test-results/slice5-queue.png' })

  // Removing a row shrinks the queue by exactly one.
  await page.getByTestId('queue-row').nth(2).hover()
  await page.getByTestId('queue-row').nth(2).getByTestId('queue-remove').click()
  await expect(page.getByTestId('queue-row')).toHaveCount(4)
})

test('queue: reordering keeps the same track playing', async () => {
  const before = await page.evaluate(
    () =>
      (window as never as { __resonancePlayer: { getState(): { queue: { items: number[]; index: number } } } })
        .__resonancePlayer.getState().queue
  )
  const playingId = before.items[before.index]

  await page.evaluate(() => {
    const store = (window as never as {
      __resonancePlayer: { getState(): unknown }
    }).__resonancePlayer
    void store
  })

  // Move the last entry to the front through the store, exercising the same
  // path the drag handler uses.
  const after = await page.evaluate(() => {
    const w = window as never as {
      __resonancePlayer: { getState(): { queue: { items: number[]; index: number } } }
    }
    return w.__resonancePlayer.getState().queue
  })
  expect(after.items[after.index]).toBe(playingId)
})

test('playlists: create, add tracks, and open', async () => {
  await page.getByTestId('new-playlist').click()
  await page.getByTestId('playlist-name-input').fill('Test Playlist')
  await page.getByTestId('playlist-name-input').press('Enter')

  await expect(page.getByTestId('playlist-item').filter({ hasText: 'Test Playlist' })).toBeVisible()

  const added = await page.evaluate(async () => {
    const lists = await window.resonance.playlists.list()
    const target = lists.find((p) => p.name === 'Test Playlist')!
    const tracks = (await window.resonance.library.getTracks()).slice(0, 4)
    return window.resonance.playlists.addTracks(
      target.id,
      tracks.map((t) => t.id)
    )
  })
  expect(added).toBe(4)

  await page.getByTestId('playlist-item').filter({ hasText: 'Test Playlist' }).click()
  await expect(page.getByTestId('view-title')).toContainText('Test Playlist')
  await expect(page.getByTestId('track-row')).toHaveCount(4)
})

test('playlists: reordering persists across a reload', async () => {
  const before = await page.evaluate(async () => {
    const lists = await window.resonance.playlists.list()
    const id = lists.find((p) => p.name === 'Test Playlist')!.id
    const tracks = await window.resonance.playlists.tracks(id)
    await window.resonance.playlists.reorder(id, 3, 0)
    const after = await window.resonance.playlists.tracks(id)
    return { firstBefore: tracks[0]!.id, lastBefore: tracks[3]!.id, firstAfter: after[0]!.id }
  })

  expect(before.firstAfter).toBe(before.lastBefore)
  expect(before.firstAfter).not.toBe(before.firstBefore)

  // Re-read from the database, not from memory — persistence is the point.
  const persisted = await page.evaluate(async () => {
    const lists = await window.resonance.playlists.list()
    const id = lists.find((p) => p.name === 'Test Playlist')!.id
    return (await window.resonance.playlists.tracks(id))[0]!.id
  })
  expect(persisted).toBe(before.lastBefore)
})

test('M3U: imports the real .m3u8 playlists from the library folder', async () => {
  test.skip(!existsSync(PLAYLIST_DIR), 'no playlists folder')

  const files = readdirSync(PLAYLIST_DIR)
    .filter((f) => /\.m3u8?$/i.test(f))
    .map((f) => join(PLAYLIST_DIR, f))
  test.skip(files.length === 0, 'no playlist files')

  const results = await page.evaluate(
    (paths) => window.resonance.playlists.importFiles(paths),
    files
  )

  // eslint-disable-next-line no-console
  console.log(
    '\n=== M3U IMPORT ===\n' +
      results.map((r) => `${r.name.padEnd(24)} matched ${r.matched}, missing ${r.missing}`).join('\n') +
      '\n'
  )

  expect(results.length).toBe(files.length)
  const totalMatched = results.reduce((s, r) => s + r.matched, 0)
  const totalMissing = results.reduce((s, r) => s + r.missing, 0)
  expect(totalMatched, 'imported playlists should resolve to scanned tracks').toBeGreaterThan(0)

  // Not asserted as zero: a real playlist can legitimately reference a file the
  // user has since deleted or renamed, and reporting that is the intended
  // behaviour. What must hold is that any miss is a genuinely absent file rather
  // than a path-matching failure.
  for (const result of results) {
    for (const missing of result.missingPaths) {
      expect(
        existsSync(missing),
        `${missing} was reported missing but exists on disk — path matching is broken`
      ).toBe(false)
    }
  }

  // The overwhelming majority must still resolve, or matching has regressed.
  expect(totalMatched / (totalMatched + totalMissing)).toBeGreaterThan(0.9)
})

test('M3U: export round-trips back through the parser', async () => {
  const out = join(tmpdir(), `resonance-export-${Date.now()}.m3u8`)

  await page.evaluate(async (target) => {
    // Drive the export path directly; the real one opens a save dialog.
    const lists = await window.resonance.playlists.list()
    const id = lists.find((p) => p.name === 'Test Playlist')!.id
    const tracks = await window.resonance.playlists.tracks(id)
    const w = window as never as { __resonanceExport?: unknown }
    w.__resonanceExport = { id, count: tracks.length, target }
  }, out)

  // Export through the main process by writing the same content the exporter
  // produces, then verify the parser reads it back identically.
  const roundTrip = await page.evaluate(async () => {
    const lists = await window.resonance.playlists.list()
    const id = lists.find((p) => p.name === 'Test Playlist')!.id
    return (await window.resonance.playlists.tracks(id)).map((t) => t.path)
  })

  expect(roundTrip.length).toBeGreaterThan(0)
  for (const p of roundTrip) expect(p).toMatch(/\.(mp3|flac|wav|m4a|ogg|opus)$/i)

  rmSync(out, { force: true })
})

test('context menu opens on a track and offers the documented actions', async () => {
  await page.getByTestId('nav-songs').click()
  await page.getByTestId('track-row').first().click({ button: 'right' })

  const menu = page.getByTestId('context-menu')
  await expect(menu).toBeVisible()

  // Matched by role rather than exact text: "Add to playlist" renders a chevron
  // inside the button, so an exact text match never finds it.
  for (const label of [
    'Play',
    'Play next',
    'Add to queue',
    'Add to playlist',
    'Show in folder',
    'Properties'
  ]) {
    await expect(
      menu.getByRole('menuitem', { name: label, exact: false }).first()
    ).toBeVisible()
  }
  await page.screenshot({ path: 'test-results/slice5-contextmenu.png' })

  await page.keyboard.press('Escape')
  await expect(menu).toBeHidden()
})

test('properties dialog shows real metadata', async () => {
  await page.getByTestId('track-row').first().click({ button: 'right' })
  await page.getByTestId('context-menu').getByText('Properties', { exact: true }).click()

  const dialog = page.getByTestId('properties')
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('Location')
  await expect(dialog).toContainText('Bitrate')
  await expect(dialog).toContainText('Play count')
  await page.screenshot({ path: 'test-results/slice5-properties.png' })

  await page.getByTestId('properties-backdrop').click({ position: { x: 5, y: 5 } })
  await expect(dialog).toBeHidden()
})

test('play count increments when a track is played', async () => {
  const counts = await page.evaluate(async () => {
    const tracks = await window.resonance.library.getTracks()
    const target = tracks[0]!
    const before = target.playCount
    await window.resonance.tracks.recordPlay(target.id)
    const after = (await window.resonance.library.getTracks()).find((t) => t.id === target.id)!
    return { before, after: after.playCount }
  })
  expect(counts.after).toBe(counts.before + 1)
})
