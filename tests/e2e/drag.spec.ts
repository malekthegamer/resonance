import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { ensureFixtures, FIXTURE_DIR } from '../fixtures/gen-audio'
import { launchApp } from './helpers'

/**
 * Slice 2: drag to playlist.
 *
 * Also the first e2e coverage of queue reordering. That gesture existed before
 * this slice but was only ever tested through the store, so consolidating the
 * two `DndContext`s into one had no regression net at the level where it could
 * actually break. It has one now.
 *
 * Generated fixtures only — no dependency on whatever music is on the machine.
 */

let app: ElectronApplication
let page: Page

const PLAYLIST = 'Drop Target'

/**
 * Drives a real dnd-kit drag.
 *
 * The intermediate move matters: `PointerSensor` has a 5px activation
 * threshold, so a single jump to the target arrives before the drag has begun
 * and nothing happens. The move at rest afterwards lets the collision settle
 * before the pointer is released.
 *
 * The settle at the end is not cosmetic. On drag start dnd-kit installs a
 * capturing `click` listener on the document that calls `stopPropagation`, to
 * swallow the click the drag itself generates — and it removes it on a
 * `setTimeout(…, 50)` after the drop (core.cjs, `AbstractPointerSensor.detach`).
 * Playwright can click well inside that window, so a click issued straight after
 * a drag silently does nothing. A person moving a mouse never hits it, which is
 * why this only ever looks like a test bug.
 */
const DND_CLICK_SUPPRESSION_MS = 60

async function dragOnto(source: Locator, target: Locator, whileHeld?: () => Promise<void>) {
  const from = await source.boundingBox()
  const to = await target.boundingBox()
  if (!from || !to) throw new Error('both ends of a drag must be visible')

  const sx = from.x + from.width / 2
  const sy = from.y + from.height / 2

  await page.mouse.move(sx, sy)
  await page.mouse.down()
  await page.mouse.move(sx + 12, sy + 4, { steps: 4 })
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 20 })
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2)
  if (whileHeld) await whileHeld()
  await page.mouse.up()
  await page.waitForTimeout(DND_CLICK_SUPPRESSION_MS)
}

async function playlistTrackIds(name: string): Promise<number[]> {
  return page.evaluate(async (playlistName) => {
    const lists = await window.resonance.playlists.list()
    const target = lists.find((p) => p.name === playlistName)
    if (!target) return []
    return (await window.resonance.playlists.tracks(target.id)).map((t) => t.id)
  }, name)
}

async function selectedIds(): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="track-row"][aria-selected="true"]')].map(
      (el) => el.getAttribute('data-track-id') ?? ''
    )
  )
}

const rowAt = (i: number): Locator => page.getByTestId('track-row').nth(i)
const playlistRow = (name: string): Locator =>
  page.getByTestId('playlist-item').filter({ hasText: name })

const queueIds = (): Promise<number[]> =>
  page.evaluate(
    () =>
      (
        window as never as {
          __resonancePlayer: { getState(): { queue: { items: number[] } } }
        }
      ).__resonancePlayer.getState().queue.items
  )

/** Seeds a known queue, so the reorder tests do not depend on test order. */
async function seedQueue(count: number): Promise<number[]> {
  return page.evaluate(async (n) => {
    const tracks = (await window.resonance.library.getTracks()).slice(0, n)
    await (
      window as never as {
        __resonancePlayer: { playTracks(t: unknown[], i: number): Promise<void> }
      }
    ).__resonancePlayer.playTracks(tracks, 0)
    return tracks.map((t) => t.id)
  }, count)
}

async function openQueue(): Promise<void> {
  if (await page.getByTestId('queue-panel').isVisible()) return
  await page.getByTestId('open-queue').click()
  await expect(page.getByTestId('queue-panel')).toBeVisible()
}

test.beforeAll(async () => {
  ensureFixtures()
  ;({ app, page } = await launchApp())

  await page.evaluate((dir) => window.resonance.library.scanPaths([dir]), FIXTURE_DIR)
  await page.reload()
  await page.waitForSelector('[data-testid="track-row"]')
  await page.getByTestId('sort-title').click()

  // The test userData directory survives between runs, and a retry re-runs this
  // hook — so a leftover playlist of the same name would make every locator
  // ambiguous. Clear it out rather than relying on a clean slate.
  await page.evaluate(async (name) => {
    for (const pl of await window.resonance.playlists.list()) {
      if (pl.name === name) await window.resonance.playlists.remove(pl.id)
    }
  }, PLAYLIST)

  await page.getByTestId('new-playlist').click()
  await page.getByTestId('playlist-name-input').fill(PLAYLIST)
  await page.getByTestId('playlist-name-input').press('Enter')
  await expect(playlistRow(PLAYLIST)).toBeVisible()
})

test.afterAll(async () => {
  await app?.close()
})

test.beforeEach(async () => {
  await page.getByTestId('nav-songs').click()
  await page.keyboard.press('Escape')
})

test('dragging a multi-selection onto a playlist adds every selected track', async () => {
  await rowAt(0).click()
  await rowAt(2).click({ modifiers: ['Shift'] })
  expect(await selectedIds()).toHaveLength(3)

  const expected = (await selectedIds()).map(Number).sort((a, b) => a - b)
  expect(await playlistTrackIds(PLAYLIST)).toHaveLength(0)

  await dragOnto(rowAt(1), playlistRow(PLAYLIST), async () => {
    // The batch has to be legible mid-drag, and the target has to say it is armed.
    await expect(page.getByTestId('drag-chip')).toHaveText('3 tracks')
    await expect(playlistRow(PLAYLIST)).toHaveAttribute('data-drop-over', 'true')
    await page.screenshot({ path: 'test-results/drag-onto-playlist.png' })
  })

  // Read back from the database, not the store: persistence is the point.
  await expect.poll(() => playlistTrackIds(PLAYLIST)).toHaveLength(3)
  expect((await playlistTrackIds(PLAYLIST)).sort((a, b) => a - b)).toEqual(expected)

  await expect(page.getByTestId('toast')).toContainText(`Added 3 tracks to ${PLAYLIST}`)
})

test('the overlay disappears and no target stays armed after the drop', async () => {
  await expect(page.getByTestId('drag-chip')).toBeHidden()
  await expect(playlistRow(PLAYLIST)).not.toHaveAttribute('data-drop-over', 'true')
})

test('dragging a row outside the selection carries only that row', async () => {
  await rowAt(0).click()
  await rowAt(2).click({ modifiers: ['Shift'] })
  expect(await selectedIds()).toHaveLength(3)

  const before = await playlistTrackIds(PLAYLIST)

  // Row 5 is not in the selection. Dragging it must not drag the other three.
  await dragOnto(rowAt(5), playlistRow(PLAYLIST), async () => {
    await expect(page.getByTestId('drag-chip')).toBeVisible()
    await expect(page.getByTestId('drag-chip')).not.toHaveText('3 tracks')
  })

  await expect.poll(() => playlistTrackIds(PLAYLIST)).toHaveLength(before.length + 1)

  // And the selection follows the drag, so the highlight never lies about what
  // would move next.
  expect(await selectedIds()).toHaveLength(1)
})

test('dropping onto the queue panel appends the tracks', async () => {
  await seedQueue(3)
  await openQueue()
  await expect(page.getByTestId('queue-row')).toHaveCount(3)

  await rowAt(0).click()
  await rowAt(1).click({ modifiers: ['Shift'] })
  await dragOnto(rowAt(0), page.getByTestId('queue-panel'), async () => {
    await expect(page.getByTestId('queue-panel')).toHaveAttribute('data-drop-over', 'true')
    await page.screenshot({ path: 'test-results/drag-into-queue.png' })
  })

  await expect(page.getByTestId('queue-row')).toHaveCount(5)
})

test('queue rows still reorder after the DndContext consolidation', async () => {
  await seedQueue(5)
  await openQueue()
  await expect(page.getByTestId('queue-row')).toHaveCount(5)

  const before = await queueIds()
  const moved = before[0]!

  await dragOnto(page.getByTestId('queue-row').nth(0), page.getByTestId('queue-row').nth(2))

  const after = await queueIds()
  expect(after, 'reorder must not add or drop entries').toHaveLength(before.length)
  expect(after).toContain(moved)
  expect(after.indexOf(moved), 'the first entry should have moved down').toBeGreaterThan(0)
})

test('a queue row cannot be dropped onto a playlist', async () => {
  await seedQueue(5)
  await openQueue()
  const before = await playlistTrackIds(PLAYLIST)

  // Queue rows are pinned to the vertical axis, so the pointer cannot reach the
  // sidebar. Asserting it anyway: the modifier is applied per drag now, and a
  // wrong `activeDrag` type would quietly let a queue row through.
  await dragOnto(page.getByTestId('queue-row').nth(0), playlistRow(PLAYLIST))

  expect(await playlistTrackIds(PLAYLIST)).toEqual(before)
  await page.getByTestId('open-queue').click()
  await expect(page.getByTestId('queue-panel')).toBeHidden()
})

test('a plain click still selects and a double-click still plays', async () => {
  // The 5px activation threshold is the only thing keeping drag from swallowing
  // both gestures — the exact failure that made the sidebar feel broken before.
  await rowAt(3).click()
  expect(await selectedIds()).toHaveLength(1)

  await rowAt(4).dblclick()
  await expect.poll(() => page.getByTestId('np-title').textContent()).not.toBe('Nothing playing')
})
