import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { BULK_TERM, ensureBulkFixtures, ensureFixtures, FIXTURE_DIR } from '../fixtures/gen-audio'
import { launchApp } from './helpers'

/**
 * Slice 1: track selection.
 *
 * Deliberately uses only generated fixtures — no dependency on whatever music
 * happens to be on the machine, which is what broke the first CI run.
 */

let app: ElectronApplication
let page: Page

/**
 * Selected ids from the store, independent of what is mounted.
 * Use this whenever selected rows might scroll out of the virtualized window.
 */
async function storeSelection(): Promise<number[]> {
  return page.evaluate(() => {
    const store = (
      window as never as {
        __resonanceSelection: { getState(): { selection: { ids: Set<number> } } }
      }
    ).__resonanceSelection
    return [...store.getState().selection.ids].sort((a, b) => a - b)
  })
}

/** Rows are virtualized, so this reads what is actually mounted. */
async function selectedIds(): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="track-row"][aria-selected="true"]')].map(
      (el) => el.getAttribute('data-track-id') ?? ''
    )
  )
}

async function rowAt(index: number) {
  return page.getByTestId('track-row').nth(index)
}

test.beforeAll(async () => {
  ensureFixtures()
  ensureBulkFixtures()
  ;({ app, page } = await launchApp())

  await page.evaluate((dir) => window.resonance.library.scanPaths([dir]), FIXTURE_DIR)
  await page.reload()
  await page.waitForSelector('[data-testid="track-row"]')
  // Sort by title so row order is deterministic across runs.
  await page.getByTestId('sort-title').click()
})

test.afterAll(async () => {
  await app?.close()
})

test.beforeEach(async () => {
  await page.keyboard.press('Escape')
})

test('a single click selects exactly one track', async () => {
  await expect(await rowAt(2)).toBeVisible()
  await (await rowAt(2)).click()

  const ids = await selectedIds()
  expect(ids).toHaveLength(1)

  await page.screenshot({ path: 'test-results/selection-single.png' })
})

test('clicking another track replaces the selection', async () => {
  await (await rowAt(1)).click()
  const first = await selectedIds()
  await (await rowAt(4)).click()
  const second = await selectedIds()

  expect(second).toHaveLength(1)
  expect(second[0]).not.toBe(first[0])
})

test('ctrl-click adds and removes without losing the rest', async () => {
  await (await rowAt(0)).click()
  await (await rowAt(2)).click({ modifiers: ['ControlOrMeta'] })
  await (await rowAt(4)).click({ modifiers: ['ControlOrMeta'] })
  expect(await selectedIds()).toHaveLength(3)

  // Ctrl-clicking a selected row removes just that one.
  await (await rowAt(2)).click({ modifiers: ['ControlOrMeta'] })
  expect(await selectedIds()).toHaveLength(2)
})

test('shift-click selects the whole span', async () => {
  await (await rowAt(1)).click()
  await (await rowAt(6)).click({ modifiers: ['Shift'] })

  // Rows 1..6 inclusive.
  expect(await selectedIds()).toHaveLength(6)
  await page.screenshot({ path: 'test-results/selection-range.png' })
})

test('shift-click backwards selects the same span', async () => {
  await (await rowAt(6)).click()
  await (await rowAt(1)).click({ modifiers: ['Shift'] })
  expect(await selectedIds()).toHaveLength(6)
})

test('the shift anchor stays put, so a range can be shrunk', async () => {
  await (await rowAt(1)).click()
  await (await rowAt(7)).click({ modifiers: ['Shift'] })
  expect(await selectedIds()).toHaveLength(7)

  await (await rowAt(3)).click({ modifiers: ['Shift'] })
  expect(await selectedIds()).toHaveLength(3)
})

test('Ctrl+A selects everything visible and Escape clears it', async () => {
  const total = await page.evaluate(() =>
    window.resonance.library.getTracks().then((t) => t.length)
  )

  await page.getByTestId('track-scroll').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('ControlOrMeta+a')

  // Only mounted rows can report as selected, but every mounted row must be.
  const mounted = await page.getByTestId('track-row').count()
  expect(await selectedIds()).toHaveLength(mounted)
  expect(total).toBeGreaterThan(mounted)

  await page.keyboard.press('Escape')
  expect(await selectedIds()).toHaveLength(0)
})

test('double-click still plays, and selection does not swallow it', async () => {
  await (await rowAt(3)).dblclick()
  await expect.poll(() => page.getByTestId('np-title').textContent()).not.toBe('Nothing playing')
})

test('navigating clears the selection', async () => {
  await (await rowAt(0)).click()
  await (await rowAt(3)).click({ modifiers: ['Shift'] })
  expect((await selectedIds()).length).toBeGreaterThan(1)

  // Stale selection would let a bulk action hit tracks that are off screen.
  await page.getByTestId('nav-albums').click()
  await page.getByTestId('nav-songs').click()
  expect(await selectedIds()).toHaveLength(0)
})

test('selection survives a re-sort and follows the tracks', async () => {
  await (await rowAt(0)).click()
  await (await rowAt(2)).click({ modifiers: ['ControlOrMeta'] })
  const before = await storeSelection()
  expect(before).toHaveLength(2)

  // Reverses the order. Selection is keyed by id, so the same TRACKS stay
  // selected even though their row positions changed — and after reversing they
  // sit at the far end of the list, outside the virtualized window, which is
  // why this reads the store rather than the DOM.
  await page.getByTestId('sort-title').click()
  expect(await storeSelection()).toEqual(before)

  await page.getByTestId('sort-title').click()
})

test('right-clicking inside a multi-selection keeps it and the menu says so', async () => {
  await (await rowAt(0)).click()
  await (await rowAt(2)).click({ modifiers: ['Shift'] })
  expect(await selectedIds()).toHaveLength(3)

  await (await rowAt(1)).click({ button: 'right' })
  expect(await selectedIds(), 'right-click inside a selection must not collapse it').toHaveLength(3)

  const menu = page.getByTestId('context-menu')
  await expect(menu).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: /Add to queue \(3 tracks\)/ })).toBeVisible()

  await page.screenshot({ path: 'test-results/selection-contextmenu.png' })
  await page.keyboard.press('Escape')
})

test('right-clicking outside the selection narrows to that row', async () => {
  await (await rowAt(0)).click()
  await (await rowAt(2)).click({ modifiers: ['Shift'] })

  await (await rowAt(6)).click({ button: 'right' })
  expect(await selectedIds()).toHaveLength(1)
  await page.keyboard.press('Escape')
})

test('a bulk action applies to every selected track', async () => {
  await page.getByTestId('nav-songs').click()
  await (await rowAt(0)).click()
  await (await rowAt(3)).click({ modifiers: ['Shift'] })
  expect(await selectedIds()).toHaveLength(4)

  await (await rowAt(1)).click({ button: 'right' })
  await page.getByTestId('context-menu').getByRole('menuitem', { name: /Add to queue/ }).click()

  const queued = await page.evaluate(
    () =>
      (
        window as never as {
          __resonanceStore: { getState(): { queue: { items: number[] } } }
        }
      ).__resonanceStore.getState().queue.items.length
  )
  expect(queued, 'all four selected tracks should reach the queue').toBeGreaterThanOrEqual(4)
})

test('search results can be selected too', async () => {
  await page.getByTestId('search').fill(BULK_TERM)
  await expect.poll(async () => page.getByTestId('track-row').count()).toBeGreaterThan(2)

  await (await rowAt(0)).click()
  await (await rowAt(2)).click({ modifiers: ['Shift'] })
  expect(await selectedIds()).toHaveLength(3)

  await page.getByTestId('nav-songs').click()
})
