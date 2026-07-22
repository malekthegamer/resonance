import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { ensureFixtures, FIXTURE_DIR } from '../fixtures/gen-audio'
import { launchApp } from './helpers'

/**
 * Slice 8: session restore (including window state, plan §A5), crossfade,
 * sleep timer, and folder watching.
 *
 * Session restore is verified across a genuine quit-and-relaunch, not a page
 * reload — reload keeps the main process alive and would not prove persistence.
 */

async function seed(page: Page): Promise<void> {
  const roots = [FIXTURE_DIR]
  const music = join(homedir(), 'Music')
  if (existsSync(music)) roots.push(music)
  await page.evaluate((paths) => window.resonance.library.scanPaths(paths), roots)
}

test('a full session survives quit and relaunch', async () => {
  ensureFixtures()

  // --- first run: set up a session ---
  const first = await launchApp()
  await seed(first.page)
  await first.page.reload()
  await first.page.waitForSelector('[data-testid="track-row"]')

  const saved = await first.page.evaluate(async () => {
    const tracks = (await window.resonance.library.getTracks()).slice(0, 6)
    const w = window as never as {
      __resonancePlayer: {
        playTracks(t: unknown[], i: number): Promise<void>
        seek(s: number): void
      }
    }
    await w.__resonancePlayer.playTracks(tracks, 2)
    await new Promise((r) => setTimeout(r, 900))

    const store = (
      window as never as {
        __resonanceStore: {
          getState(): {
            setVolume(v: number): void
            cycleRepeat(): void
            toggleShuffle(): void
            persistSession(): void
            queue: { items: number[]; index: number }
            position: number
          }
        }
      }
    ).__resonanceStore

    const s = store.getState()
    s.setVolume(0.42)
    s.cycleRepeat() // -> 'all'
    w.__resonancePlayer.seek(2.5)
    await new Promise((r) => setTimeout(r, 400))
    store.getState().persistSession()
    await new Promise((r) => setTimeout(r, 250))

    const settings = await window.resonance.settings.getAll()
    return {
      trackId: store.getState().queue.items[store.getState().queue.index],
      queueLength: store.getState().queue.items.length,
      session: settings.session,
      volume: settings.volume
    }
  })

  expect(saved.session, 'a session should have been written').toBeTruthy()
  expect(saved.session!.queue.length).toBe(6)
  expect(saved.volume).toBeCloseTo(0.42, 2)

  // Resize so window state has something distinctive to restore.
  await first.app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]!.setBounds({ x: 140, y: 90, width: 1100, height: 740 })
  })
  await first.page.waitForTimeout(700)

  const boundsBefore = await first.app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]!.getNormalBounds()
  )

  await first.app.close()

  // --- second run: everything must come back ---
  const second = await launchApp()
  await second.page.waitForTimeout(1500)

  const restored = await second.page.evaluate(async () => {
    const store = (
      window as never as {
        __resonanceStore: {
          getState(): {
            queue: { items: number[]; index: number; repeat: string }
            position: number
            volume: number
            current: { id: number } | null
          }
        }
      }
    ).__resonanceStore
    const s = store.getState()
    return {
      queueLength: s.queue.items.length,
      index: s.queue.index,
      trackId: s.current?.id ?? null,
      position: s.position,
      volume: s.volume,
      repeat: s.queue.repeat
    }
  })

  const boundsAfter = await second.app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]!.getNormalBounds()
  )

  // eslint-disable-next-line no-console
  console.log(
    `\n=== SESSION RESTORE ===\n` +
      `queue      : ${saved.queueLength} -> ${restored.queueLength}\n` +
      `track id   : ${saved.trackId} -> ${restored.trackId}\n` +
      `position   : ${saved.session!.positionSec.toFixed(2)}s -> ${restored.position.toFixed(2)}s\n` +
      `volume     : ${saved.volume} -> ${restored.volume}\n` +
      `repeat     : ${saved.session!.repeat} -> ${restored.repeat}\n` +
      `window     : ${boundsBefore.width}x${boundsBefore.height}@${boundsBefore.x},${boundsBefore.y}` +
      ` -> ${boundsAfter.width}x${boundsAfter.height}@${boundsAfter.x},${boundsAfter.y}\n`
  )

  expect(restored.queueLength).toBe(saved.queueLength)
  expect(restored.trackId).toBe(saved.trackId)
  expect(restored.volume).toBeCloseTo(0.42, 2)
  expect(restored.repeat).toBe('all')
  expect(restored.position).toBeGreaterThan(1.5)

  // Plan §A5: window geometry is part of the session.
  expect(boundsAfter.width).toBe(boundsBefore.width)
  expect(boundsAfter.height).toBe(boundsBefore.height)
  expect(boundsAfter.x).toBe(boundsBefore.x)
  expect(boundsAfter.y).toBe(boundsBefore.y)

  // Restored paused, not resumed: launching into unexpected audio is startling.
  const playing = await second.page.evaluate(
    () =>
      (window as never as { __resonanceTestEngine: { playing: boolean } }).__resonanceTestEngine
        .playing
  )
  expect(playing, 'session restores paused rather than auto-playing').toBe(false)

  await second.page.screenshot({ path: 'test-results/slice8-restored.png' })
  await second.app.close()
})

test('off-screen saved bounds fall back to a visible window', async () => {
  // A rectangle left over from a disconnected monitor must not restore the
  // window somewhere unreachable, where the app looks like it failed to launch.
  const setup = await launchApp()
  await setup.page.evaluate(() =>
    window.resonance.settings.set('windowState', {
      x: -32000,
      y: -32000,
      width: 1100,
      height: 700,
      isMaximized: false
    })
  )
  await setup.page.waitForTimeout(300)
  await setup.app.close()

  const relaunch = await launchApp()
  const bounds = await relaunch.app.evaluate(({ BrowserWindow, screen }) => {
    const win = BrowserWindow.getAllWindows()[0]!
    const b = win.getBounds()
    const onScreen = screen.getAllDisplays().some((d) => {
      const wa = d.workArea
      return b.x < wa.x + wa.width && b.x + b.width > wa.x && b.y < wa.y + wa.height && b.y + b.height > wa.y
    })
    return { ...b, onScreen }
  })

  expect(bounds.onScreen, 'window must land on a real display').toBe(true)
  await relaunch.app.close()
})

let app: ElectronApplication
let page: Page

test.describe('crossfade, sleep timer and watching', () => {
  test.beforeAll(async () => {
    ensureFixtures()
    ;({ app, page } = await launchApp())
    await seed(page)
    await page.reload()
    await page.waitForSelector('[data-testid="track-row"]')
  })

  test.afterAll(async () => {
    await app?.close()
  })

  test('crossfade reaches the audio engine', async () => {
    await page.getByTestId('open-settings').click()
    await page.getByTestId('crossfade-slider').fill('6')
    await page.getByTestId('crossfade-slider').dispatchEvent('change')

    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as never as { __resonanceTestEngine: { getCrossfade(): number } })
              .__resonanceTestEngine.getCrossfade()
        )
      )
      .toBe(6)

    // A saved value must also survive into the settings file.
    const saved = await page.evaluate(() => window.resonance.settings.getAll())
    expect(saved.crossfadeSec).toBe(6)
  })

  test('crossfading between two tracks keeps playback continuous', async () => {
    const result = await page.evaluate(async () => {
      const tracks = await window.resonance.library.getTracks()
      const short = tracks.find((t) => t.path.toLowerCase().endsWith('tone-440-6db.wav'))!
      const other = tracks.find((t) => t.id !== short.id)!

      const w = window as never as {
        __resonancePlayer: { playTracks(t: unknown[], i: number): Promise<void> }
        __resonanceTestEngine: {
          getCrossfade(): number
          crossfadeTo(id: number): Promise<void>
          playing: boolean
          currentTrackId: number | null
        }
      }
      await w.__resonancePlayer.playTracks([short, other], 0)
      await new Promise((r) => setTimeout(r, 700))

      const engine = w.__resonanceTestEngine
      await engine.crossfadeTo(other.id)
      // Mid-fade: audio must still be running, not stopped between tracks.
      await new Promise((r) => setTimeout(r, 400))
      const playingMidFade = engine.playing
      const idMidFade = engine.currentTrackId
      return { playingMidFade, idMidFade, otherId: other.id }
    })

    expect(result.playingMidFade, 'audio must not stop during a crossfade').toBe(true)
    expect(result.idMidFade).toBe(result.otherId)
  })

  test('sleep timer counts down and can be cancelled', async () => {
    await page.getByTestId('open-settings').click().catch(() => undefined)
    if (!(await page.getByTestId('settings-panel').isVisible())) {
      await page.getByTestId('open-settings').click()
    }

    await page.getByTestId('sleep-15').click()
    await expect(page.getByTestId('sleep-active')).toBeVisible()
    await expect(page.getByTestId('sleep-active')).toContainText(/1[45]:/)

    await page.getByTestId('sleep-cancel').click()
    await expect(page.getByTestId('sleep-options')).toBeVisible()
  })

  test('end-of-track sleep mode stops instead of advancing', async () => {
    const outcome = await page.evaluate(async () => {
      const tracks = await window.resonance.library.getTracks()
      const short = tracks.find((t) => t.path.toLowerCase().endsWith('tone-440-6db.wav'))!
      const others = tracks.filter((t) => t.id !== short.id).slice(0, 2)

      const store = (
        window as never as {
          __resonanceStore: {
            getState(): {
              playTracks(t: unknown[], i: number): Promise<void>
              setSleepEndOfTrack(): void
              seek(s: number): void
              queue: { index: number }
              playing: boolean
              sleep: { mode: string }
            }
          }
        }
      ).__resonanceStore

      await store.getState().playTracks([short, ...others], 0)
      const engine = (window as never as { __resonanceTestEngine: { duration: number } })
        .__resonanceTestEngine
      for (let i = 0; i < 60 && engine.duration === 0; i++) {
        await new Promise((r) => setTimeout(r, 100))
      }

      store.getState().setSleepEndOfTrack()
      store.getState().seek(Math.max(0, engine.duration - 0.4))
      await new Promise((r) => setTimeout(r, 3000))

      const s = store.getState()
      return { index: s.queue.index, playing: s.playing, mode: s.sleep.mode }
    })

    // It must stop on the SAME track rather than advancing to the next.
    expect(outcome.index, 'end-of-track sleep must not advance the queue').toBe(0)
    expect(outcome.playing).toBe(false)
    expect(outcome.mode).toBe('off')
  })
})
