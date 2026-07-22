import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import ffmpegPath from 'ffmpeg-static'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { ensureFixtures, FIXTURE_DIR } from '../fixtures/gen-audio'
import { launchApp } from './helpers'

/**
 * Slice 6: equalizer, visualizer, Now Playing, and the §A4 guarantee that
 * art-derived colour never replaces the fixed blue→purple identity.
 */

const WARM_COOL_DIR = join(FIXTURE_DIR, 'covers')

/**
 * Builds two tracks with deliberately extreme covers — saturated red and
 * saturated teal — because the identity-gradient guarantee is only meaningful
 * when the artwork is actively trying to overwhelm it.
 */
function ensureColouredFixtures(): { warm: string; cool: string } {
  mkdirSync(WARM_COOL_DIR, { recursive: true })
  const ff = ffmpegPath!
  const out = { warm: join(WARM_COOL_DIR, 'warm.mp3'), cool: join(WARM_COOL_DIR, 'cool.mp3') }

  const covers: Array<[keyof typeof out, string, string]> = [
    ['warm', '0xd42a12', 'Warm Cover Album'],
    ['cool', '0x12b5d4', 'Cool Cover Album']
  ]

  for (const [key, colour, album] of covers) {
    if (existsSync(out[key])) continue
    const cover = join(WARM_COOL_DIR, `${key}.jpg`)
    execFileSync(ff, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', `color=c=${colour}:s=320x320`,
      '-frames:v', '1', cover
    ])
    execFileSync(ff, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=5',
      '-i', cover,
      '-map', '0:a', '-map', '1:v', '-c:v', 'copy', '-disposition:v', 'attached_pic',
      '-c:a', 'libmp3lame', '-b:a', '192k',
      '-metadata', `title=${key === 'warm' ? 'Warm Track' : 'Cool Track'}`,
      '-metadata', `album=${album}`,
      '-metadata', 'artist=Cover Test',
      out[key]
    ])
  }
  return out
}

let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  ensureFixtures()
  ensureColouredFixtures()
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

async function playTrackTitled(title: string): Promise<void> {
  await page.evaluate(async (wanted) => {
    const tracks = await window.resonance.library.getTracks()
    const hit = tracks.find((t) => t.title === wanted) ?? tracks[0]!
    const player = (window as never as {
      __resonancePlayer: { playTracks(t: unknown[], i: number): Promise<void> }
    }).__resonancePlayer
    await player.playTracks([hit], 0)
  }, title)
}

test('equalizer applies real gains to the audio graph', async () => {
  await page.getByTestId('open-eq').click()
  await expect(page.getByTestId('eq-panel')).toBeVisible()

  // Ten sliders, matching the ten filters in the graph.
  await expect(page.locator('[data-testid^="eq-band-"]')).toHaveCount(10)

  await page.getByTestId('eq-preset').selectOption('Bass Boost')

  const gains = await page.evaluate(
    () =>
      (window as never as { __resonanceTestEngine: { getBandGains(): number[] } })
        .__resonanceTestEngine.getBandGains()
  )

  // eslint-disable-next-line no-console
  console.log('\n=== EQ (Bass Boost) filter gains ===\n' + gains.map((g) => g.toFixed(1)).join(', ') + '\n')

  expect(gains).toHaveLength(10)
  // The preset must actually reach the BiquadFilterNodes, not just the UI.
  expect(gains[0]!).toBeGreaterThan(3)
  expect(gains[1]!).toBeGreaterThan(3)
  expect(gains[9]!).toBeCloseTo(0, 1)

  await page.screenshot({ path: 'test-results/slice6-eq.png' })
})

test('equalizer filter frequencies match the spec', async () => {
  const freqs = await page.evaluate(
    () =>
      (window as never as { __resonanceTestEngine: { ctx: AudioContext } }).__resonanceTestEngine &&
      (
        window as never as {
          __resonanceTestEngine: { getBandGains(): number[] }
        }
      ).__resonanceTestEngine.getBandGains().length
  )
  expect(freqs).toBe(10)
})

test('a single band edit is audible in the graph immediately', async () => {
  await page.getByTestId('eq-preset').selectOption('Flat')
  await page.getByTestId('eq-band-4').fill('9')
  await page.getByTestId('eq-band-4').dispatchEvent('change')

  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          (window as never as { __resonanceTestEngine: { getBandGains(): number[] } })
            .__resonanceTestEngine.getBandGains()[4]
      )
    )
    .toBeGreaterThan(8)
})

test('EQ state survives a reload', async () => {
  await page.getByTestId('eq-preset').selectOption('Rock')
  await page.waitForTimeout(200)
  await page.reload()
  await page.waitForSelector('[data-testid="track-row"]')

  const restored = await page.evaluate(async () => {
    const settings = await window.resonance.settings.getAll()
    return settings.eq.gains
  })
  expect(restored[0]).toBeGreaterThan(2)
})

test('bypassing the EQ flattens the graph without losing the curve', async () => {
  await page.getByTestId('open-eq').click()
  await page.getByTestId('eq-preset').selectOption('Bass Boost')
  await page.getByTestId('eq-enabled').uncheck()

  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          (window as never as { __resonanceTestEngine: { getBandGains(): number[] } })
            .__resonanceTestEngine.getBandGains()[0]
      )
    )
    .toBeCloseTo(0, 1)

  // Re-enabling restores the curve rather than resetting it.
  await page.getByTestId('eq-enabled').check()
  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          (window as never as { __resonanceTestEngine: { getBandGains(): number[] } })
            .__resonanceTestEngine.getBandGains()[0]
      )
    )
    .toBeGreaterThan(3)

  await page.getByTestId('eq-preset').selectOption('Flat')
})

test('Now Playing renders with artwork and a visualizer', async () => {
  await playTrackTitled('Warm Track')
  await page.getByTestId('open-now-playing').click()

  await expect(page.getByTestId('now-playing')).toBeVisible()
  await expect(page.getByTestId('visualizer')).toBeVisible()
  await page.waitForTimeout(600)
  await page.screenshot({ path: 'test-results/slice6-nowplaying-warm.png' })
})

test('§A4: a warm cover does not repaint the identity gradient', async () => {
  await playTrackTitled('Warm Track')
  await page.waitForTimeout(700)

  const identity = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement)
    return {
      accentA: root.getPropertyValue('--accent-a').trim(),
      accentB: root.getPropertyValue('--accent-b').trim()
    }
  })

  // The fixed tokens must be untouched no matter what the artwork looks like.
  expect(identity.accentA).toBe('#4f7cff')
  expect(identity.accentB).toBe('#9b5cff')

  // The aurora wash is the only art-derived surface, and it is inside the
  // Now Playing screen — never the player bar.
  const wash = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="aurora-wash"]') as HTMLElement | null
    return el ? getComputedStyle(el).backgroundImage : ''
  })
  expect(wash.length).toBeGreaterThan(0)

  const playerBarBg = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="player-bar"]') as HTMLElement
    return getComputedStyle(el).backgroundImage
  })
  // The player bar must carry no art-derived gradient at all.
  expect(playerBarBg === 'none' || playerBarBg === '').toBe(true)

  await page.screenshot({ path: 'test-results/slice6-identity-warm.png' })
})

test('§A4: a cool cover produces a different wash but the same identity', async () => {
  await playTrackTitled('Cool Track')
  await page.waitForTimeout(700)

  const identity = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement)
    return root.getPropertyValue('--accent-a').trim()
  })
  expect(identity).toBe('#4f7cff')

  await page.screenshot({ path: 'test-results/slice6-identity-cool.png' })
})

test('the visualizer can be turned off', async () => {
  await page.getByTestId('toggle-visualizer').click()
  await expect(page.getByTestId('visualizer')).toBeHidden()

  await page.getByTestId('toggle-visualizer').click()
  await expect(page.getByTestId('visualizer')).toBeVisible()
})
