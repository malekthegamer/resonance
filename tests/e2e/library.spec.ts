import { homedir } from 'node:os'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { ensureFixtures, FIXTURE_DIR } from '../fixtures/gen-audio'
import { launchApp } from './helpers'

/** Slice 3: library views rendered against the real scanned library. */

let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  ensureFixtures()
  ;({ app, page } = await launchApp())

  // Make sure there is a library to render, whatever order suites ran in.
  const roots = [FIXTURE_DIR]
  const music = join(homedir(), 'Music')
  if (existsSync(music)) roots.push(music)
  await page.evaluate((paths) => window.resonance.library.scanPaths(paths), roots)
  await page.evaluate(() => window.resonance.library.getTracks())
  await page.reload()
  await page.waitForSelector('[data-testid="track-row"]')
})

test.afterAll(async () => {
  await app?.close()
})

test('Songs view lists the real library', async () => {
  const count = await page.getByTestId('track-count').textContent()
  expect(count).toMatch(/\d+ tracks/)

  const rows = await page.getByTestId('track-row').count()
  expect(rows).toBeGreaterThan(0)
  await page.screenshot({ path: 'test-results/slice3-songs.png' })
})

test('only visible rows are mounted — the list is virtualized', async () => {
  const total = await page.evaluate(() => window.resonance.library.getTracks().then((t) => t.length))
  const mounted = await page.getByTestId('track-row').count()

  // With ~61 tracks and a ~46px row height, a windowed list mounts far fewer
  // rows than the library holds. If this ever equals `total`, virtualization has
  // silently stopped working and large libraries will jank.
  expect(mounted).toBeLessThan(total)
  expect(mounted).toBeGreaterThan(5)
})

test('column sorting reorders and reverses', async () => {
  await page.getByTestId('sort-title').click()
  const asc = await page.getByTestId('track-row').first().textContent()

  await page.getByTestId('sort-title').click()
  const desc = await page.getByTestId('track-row').first().textContent()

  expect(asc).not.toBe(desc)
})

test('Albums, Artists and Genres views render and drill down', async () => {
  await page.getByTestId('nav-albums').click()
  await expect(page.getByTestId('album-grid')).toBeVisible()
  await page.screenshot({ path: 'test-results/slice3-albums.png' })

  // Drilling into an album shows its tracks and offers a way back.
  await page.getByTestId('album-grid').locator('button').first().click()
  await expect(page.getByTestId('track-table')).toBeVisible()
  await page.getByTestId('back').click()
  await expect(page.getByTestId('album-grid')).toBeVisible()

  await page.getByTestId('nav-artists').click()
  await expect(page.getByTestId('artist-grid')).toBeVisible()
  await page.screenshot({ path: 'test-results/slice3-artists.png' })

  await page.getByTestId('nav-genres').click()
  await expect(page.getByTestId('genre-grid')).toBeVisible()

  await page.getByTestId('nav-songs').click()
  await expect(page.getByTestId('track-table')).toBeVisible()
})

test('search narrows the library through the FTS index', async () => {
  await page.getByTestId('search').fill('titan')
  await expect(page.getByTestId('view-title')).toContainText('Search')

  const hits = await page.getByTestId('track-row').count()
  expect(hits).toBeGreaterThan(0)
  await page.screenshot({ path: 'test-results/slice3-search.png' })

  // A query matching nothing must show the empty state, not a stale list.
  await page.getByTestId('search').fill('zzzznotathing')
  await expect(page.getByTestId('empty-state')).toBeVisible()

  await page.getByTestId('search').fill('')
  await expect(page.getByTestId('track-table')).toBeVisible()
})

test('Ctrl+F focuses the search box', async () => {
  await page.keyboard.press('Control+f')
  const focused = await page.evaluate(
    () => document.activeElement?.getAttribute('data-testid') ?? ''
  )
  expect(focused).toBe('search')
  await page.keyboard.press('Escape')
})

test('placeholder art is deterministic and distinct per album', async () => {
  await page.getByTestId('nav-albums').click()
  await expect(page.getByTestId('album-grid')).toBeVisible()

  // This library has no embedded artwork, so every tile is a generated gradient.
  // They must differ, or the grid is an undifferentiated wall.
  const backgrounds = await page.evaluate(() => {
    const tiles = [...document.querySelectorAll('[data-testid="album-grid"] button > div')]
    return tiles.slice(0, 8).map((el) => getComputedStyle(el as HTMLElement).backgroundImage)
  })

  expect(backgrounds.length).toBeGreaterThan(2)
  expect(new Set(backgrounds).size).toBeGreaterThan(1)
})

test('light theme renders the library too', async () => {
  await page.getByTestId('nav-songs').click()
  await page.getByTestId('theme').click()
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset['theme']))
    .toBe('light')
  await page.screenshot({ path: 'test-results/slice3-light.png' })

  await page.getByTestId('theme').click()
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset['theme']))
    .toBe('dark')
})
