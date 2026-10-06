import { resolve } from 'node:path'
import { rmSync } from 'node:fs'
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import type { usePlayer } from '../../src/renderer/src/state/player'
import { ensureFixtures, FIXTURE_DIR } from '../fixtures/gen-audio'
import { launchApp } from './helpers'

let app: ElectronApplication
let page: Page
let playlistId: number
let initial: number[]
const USERDATA = resolve('test-results', 'playlist-reorder-userdata')
const row = (index: number) => page.locator(`[data-testid="track-row"][data-playlist-position="${index}"]`)
const persisted = () => page.evaluate(async (id) => (await window.resonance.playlists.tracks(id)).map((t) => t.id), playlistId)
async function drag(source: Locator, target: Locator, during?: () => Promise<void>) {
  const a = await source.boundingBox()
  const b = await target.boundingBox()
  if (!a || !b) throw new Error('Drag endpoints must be visible')
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
  await page.mouse.down()
  await page.mouse.move(a.x + a.width / 2 + 12, a.y + a.height / 2 + 3, { steps: 4 })
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 20 })
  if (during) await during()
  await page.mouse.up()
  await page.waitForTimeout(60)
}
test.beforeAll(async () => {
  ensureFixtures()
  rmSync(USERDATA, { recursive: true, force: true })
  ;({ app, page } = await launchApp(USERDATA))
  await page.evaluate((dir) => window.resonance.library.scanPaths([dir]), FIXTURE_DIR)
  await expect(page.getByTestId('track-row').first()).toBeVisible()
})
test.beforeEach(async () => {
  const created = await page.evaluate(async () => {
    for (const p of await window.resonance.playlists.list()) await window.resonance.playlists.remove(p.id)
    const tracks = (await window.resonance.library.getTracks()).filter((t) => !t.path.endsWith('large-tone.wav')).slice(0, 5)
    const ids = [tracks[0]!.id, tracks[1]!.id, tracks[0]!.id, tracks[2]!.id, tracks[3]!.id]
    const id = await window.resonance.playlists.create('Reorder Test')
    await window.resonance.playlists.addTracks(id, ids)
    return { id, ids }
  })
  playlistId = created.id; initial = created.ids
  await page.reload()
  await page.getByTestId('playlist-item').filter({ hasText: 'Reorder Test' }).click()
  await expect(page.getByTestId('track-row')).toHaveCount(5)
})
test.afterAll(async () => { await app?.close() })

test('row drags move down and up without changing the playing queue', async () => {
  const queue = await page.evaluate(async () => {
    const list = await window.resonance.library.getTracks()
    const s = (window as unknown as { __resonanceStore: typeof usePlayer }).__resonanceStore.getState()
    await s.playTracks(list.slice(0, 3), 0)
    return s.queue.items
  })
  const expectedQueue = await page.evaluate(() => (window as unknown as { __resonanceStore: typeof usePlayer }).__resonanceStore.getState().queue.items)
  void queue
  await drag(row(0), row(3), async () => {
    await expect(row(3)).toHaveAttribute('data-insertion', 'after')
    await page.screenshot({ path: 'test-results/playlist-reorder-dark.png' })
  })
  await expect.poll(persisted).toEqual([initial[1], initial[2], initial[3], initial[0], initial[4]])
  await page.getByTestId('theme').click()
  await drag(row(3), row(0), async () => {
    await expect(row(0)).toHaveAttribute('data-insertion', 'before')
    await page.screenshot({ path: 'test-results/playlist-reorder-light.png' })
  })
  await expect.poll(persisted).toEqual(initial)
  expect(await page.evaluate(() => (window as unknown as { __resonanceStore: typeof usePlayer }).__resonanceStore.getState().queue.items)).toEqual(expectedQueue)
  await page.getByTestId('theme').click()
})

test('moves only the grabbed duplicate occurrence under multi-selection and persists after quit', async () => {
  await row(0).click()
  await row(3).click({ modifiers: ['Shift'] })
  await drag(row(2), row(4), async () => {
    await expect(page.getByTestId('drag-chip')).not.toHaveText(/tracks$/)
  })
  const expected = [initial[0], initial[1], initial[3], initial[4], initial[2]]
  await expect.poll(persisted).toEqual(expected)
  await app.close()
  ;({ app, page } = await launchApp(USERDATA))
  await page.getByTestId('playlist-item').filter({ hasText: 'Reorder Test' }).click()
  await expect(row(4)).toHaveAttribute('data-track-id', String(initial[2]))
  expect(await persisted()).toEqual(expected)
})

test('Escape, self drops and drops outside the list leave order unchanged', async () => {
  await drag(row(1), row(3), async () => { await page.keyboard.press('Escape') })
  expect(await persisted()).toEqual(initial)
  await drag(row(1), row(1))
  expect(await persisted()).toEqual(initial)
  await drag(row(1), page.getByTestId('view-title'))
  expect(await persisted()).toEqual(initial)
  await expect(page.getByTestId('drag-chip')).toBeHidden()
  await row(1).click()
  await expect(row(1)).toHaveAttribute('aria-selected', 'true')
  await row(1).dblclick()
  await expect(page.getByTestId('np-title')).not.toHaveText('Nothing playing')
})

test('retains selected-track drops to another playlist and the queue', async () => {
  await page.evaluate(async () => { await window.resonance.playlists.create('External Target') })
  await page.reload()
  await page.getByTestId('playlist-item').filter({ hasText: 'Reorder Test' }).click()
  await row(0).click()
  await row(1).click({ modifiers: ['Control'] })
  await drag(row(1), page.getByTestId('playlist-item').filter({ hasText: 'External Target' }))
  expect(await page.evaluate(async () => {
    const p = (await window.resonance.playlists.list()).find((p) => p.name === 'External Target')!
    return (await window.resonance.playlists.tracks(p.id)).map((t) => t.id)
  })).toEqual(initial.slice(0, 3))
  expect(await persisted()).toEqual(initial)
  await page.getByTestId('open-queue').click()
  const before = await page.evaluate(() => (window as unknown as { __resonanceStore: typeof usePlayer }).__resonanceStore.getState().queue.items.length)
  await drag(row(1), page.getByTestId('queue-panel'))
  await expect(page.getByTestId('queue-row')).toHaveCount(before + 3)
  await page.getByTestId('open-queue').click()
})

test('global search stays a library view while a playlist is open', async () => {
  const title = await row(0).locator('[title]').filter({ hasText: /Bulktrack/ }).first().textContent()
  await page.getByTestId('search').fill(title?.trim() || 'Bulktrack')
  await expect(page.getByTestId('track-row').first()).toBeVisible()
  await expect(page.getByTestId('track-row').first()).not.toHaveAttribute('data-playlist-position')
  await expect(page.getByTestId('sort-title')).toBeEnabled()
  await page.getByTestId('track-row').first().click({ button: 'right' })
  await expect(page.getByText('Remove from this playlist', { exact: true })).toHaveCount(0)
  await page.keyboard.press('Escape')
  expect(await persisted()).toEqual(initial)
})

test('scrolls during a held drag and persists a move beyond the viewport', async () => {
  await page.evaluate(async (id) => {
    const first = (await window.resonance.playlists.tracks(id))[0]!
    await window.resonance.playlists.addTracks(id, Array.from({ length: 40 }, () => first.id))
  }, playlistId)
  await page.reload()
  await page.getByTestId('playlist-item').filter({ hasText: 'Reorder Test' }).click()
  const source = await row(1).boundingBox()
  const scroll = await page.getByTestId('track-scroll').boundingBox()
  if (!source || !scroll) throw new Error('Rows must be visible')
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2)
  await page.mouse.down()
  await page.mouse.move(source.x + source.width / 2 + 12, source.y + source.height / 2 + 3, { steps: 4 })
  await page.mouse.move(scroll.x + scroll.width / 2, scroll.y + scroll.height - 5, { steps: 20 })
  await expect.poll(() => page.getByTestId('track-scroll').evaluate((el) => el.scrollTop), { timeout: 10_000 }).toBeGreaterThan(400)
  await page.mouse.up()
  await expect.poll(async () => (await persisted()).indexOf(initial[1]!)).toBeGreaterThan(8)
})

test('a persistence failure restores order and displays the error', async () => {
  await app.evaluate(({ ipcMain }) => {
    const registry = (ipcMain as unknown as { _invokeHandlers: Map<string, (...args: unknown[]) => unknown> })._invokeHandlers
    const original = registry.get('pl:reorder')!
    ipcMain.removeHandler('pl:reorder')
    ipcMain.handle('pl:reorder', () => {
      ipcMain.removeHandler('pl:reorder'); ipcMain.handle('pl:reorder', original)
      throw new Error('Simulated disk failure')
    })
  })
  await drag(row(0), row(3))
  await expect(page.getByTestId('toast')).toContainText('Simulated disk failure')
  expect(await persisted()).toEqual(initial)
  await expect(row(0)).toHaveAttribute('data-track-id', String(initial[0]))
})

test('saving does not reopen a playlist after navigation away', async () => {
  await app.evaluate(({ ipcMain }) => {
    const registry = (ipcMain as unknown as { _invokeHandlers: Map<string, (...args: unknown[]) => unknown> })._invokeHandlers
    const original = registry.get('pl:reorder')!
    ipcMain.removeHandler('pl:reorder')
    ipcMain.handle('pl:reorder', async (...args) => {
      ipcMain.removeHandler('pl:reorder'); ipcMain.handle('pl:reorder', original)
      await new Promise((resolve) => setTimeout(resolve, 500))
      return original(...args)
    })
  })
  await drag(row(0), row(3))
  await page.getByTestId('nav-songs').click()
  await expect.poll(persisted).toEqual([initial[1], initial[2], initial[3], initial[0], initial[4]])
  await expect(page.getByTestId('view-title')).toHaveText('Songs')
})
