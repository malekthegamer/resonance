import { copyFileSync, existsSync, mkdirSync, rmSync, statSync, utimesSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import type { usePlayer } from '../../src/renderer/src/state/player'
import { ensureFixtures, writeWav } from '../fixtures/gen-audio'
import { launchApp } from './helpers'

let app: ElectronApplication
let page: Page
const MEDIA = resolve('test-results', 'reliability-media')
const WATCH = join(MEDIA, 'watched')
const USERDATA = resolve('test-results', 'reliability-userdata')
type StoreWindow = { __resonanceStore: typeof usePlayer }
type Deck = { el: HTMLAudioElement; gain: GainNode; trackId: number | null }
type EngineWindow = { __resonanceTestEngine: { decks: Record<string, Deck>; analyser: AnalyserNode; ctx: AudioContext; currentTrackId: number | null } }

async function playTones(count = 3): Promise<number[]> {
  return page.evaluate(async (n) => {
    const tracks = (await window.resonance.library.getTracks()).filter((t) => /transition-[123]\.wav$/.test(t.path)).slice(0, n)
    const s = (window as unknown as StoreWindow).__resonanceStore.getState()
    await s.playTracks(tracks, 0)
    return tracks.map((t) => t.id)
  }, count)
}
async function snapshot() {
  return page.evaluate(() => {
    const engine = (window as unknown as EngineWindow).__resonanceTestEngine
    const s = (window as unknown as StoreWindow).__resonanceStore.getState()
    const data = new Uint8Array(engine.analyser.frequencyBinCount)
    engine.analyser.smoothingTimeConstant = 0
    engine.analyser.getByteFrequencyData(data)
    const peakAt = (hz: number) => {
      const bin = Math.round(hz * engine.analyser.fftSize / engine.ctx.sampleRate)
      return Math.max(...data.slice(bin - 1, bin + 2))
    }
    return {
      index: s.queue.index, current: engine.currentTrackId, playing: s.playing, position: s.position,
      decks: Object.values(engine.decks).map((d) => ({ id: d.trackId, playing: !d.el.paused, gain: d.gain.gain.value, position: d.el.currentTime })),
      signal440: peakAt(440), signal880: peakAt(880), maxSignal: Math.max(...data)
    }
  })
}
test.beforeAll(async () => {
  const f = ensureFixtures()
  rmSync(MEDIA, { recursive: true, force: true })
  rmSync(USERDATA, { recursive: true, force: true })
  mkdirSync(WATCH, { recursive: true })
  writeWav(join(MEDIA, 'transition-1.wav'), 8, 440)
  writeWav(join(MEDIA, 'transition-2.wav'), 8, 880)
  writeWav(join(MEDIA, 'transition-3.wav'), 8, 1320)
  copyFileSync(f.byFormat.mp3!, join(MEDIA, 'editable.mp3'))
  ;({ app, page } = await launchApp(USERDATA))
  await page.evaluate((root) => window.resonance.library.scanPaths([root]), MEDIA)
  await expect(page.getByTestId('track-row')).toHaveCount(4)
})
test.beforeEach(async () => {
  await page.getByTestId('nav-songs').click()
  await page.evaluate(() => {
    const s = (window as unknown as StoreWindow).__resonanceStore.getState()
    s.stop(); s.setRepeat('off'); s.setCrossfade(0); s.cancelSleep()
    if (s.queue.shuffle) s.toggleShuffle()
  })
})
test.afterAll(async () => { await app?.close() })

test('queued scans settle after cancellation and refresh without a reload', async () => {
  const extra = join(MEDIA, 'queued.wav')
  writeWav(extra, 5)
  const phases = await page.evaluate(async (root) => {
    const first = window.resonance.library.scanPaths([root])
    const second = window.resonance.library.scanPaths([root])
    window.setTimeout(() => window.resonance.library.cancelScan(), 20)
    return (await Promise.all([first, second])).map((p) => p.phase)
  }, MEDIA)
  expect(phases).toEqual(['cancelled', 'done'])
  await expect(page.getByTestId('track-row')).toHaveCount(5)
})

test('newly picked folders are watched immediately, including same-mtime restoration', async () => {
  await app.evaluate(({ dialog }, root) => {
    const original = dialog.showOpenDialog
    dialog.showOpenDialog = (async () => {
      dialog.showOpenDialog = original
      return { canceled: false, filePaths: [root] }
    }) as typeof dialog.showOpenDialog
  }, WATCH)
  await page.evaluate(() => window.resonance.library.pickAndScan())
  const target = join(WATCH, 'live.wav')
  writeWav(target, 5)
  const time = statSync(target).mtime
  const id = await expect.poll(async () => {
    return page.evaluate(async (path) => (await window.resonance.library.getTracks()).find((t) => t.path === path)?.id ?? null, target)
  }).not.toBeNull()
  void id
  const trackId = await page.evaluate(async (path) => (await window.resonance.library.getTracks()).find((t) => t.path === path)!.id, target)
  const row = page.locator(`[data-testid="track-row"][data-track-id="${trackId}"]`)
  await expect(row).toBeVisible()
  rmSync(target)
  await expect(row).toContainText('missing')
  writeWav(target, 5)
  utimesSync(target, time, time)
  await expect(row).not.toContainText('missing')
  await expect.poll(() => page.evaluate(async (id) => (await window.resonance.library.getTracks()).find((t) => t.id === id)?.available, trackId)).toBe(true)
})

test('tag rescans wait behind scans and update search, playlist and now-playing metadata', async () => {
  const info = await page.evaluate(async () => {
    const t = (await window.resonance.library.getTracks()).find((t) => t.path.endsWith('editable.mp3'))!
    const id = await window.resonance.playlists.create('Live metadata')
    await window.resonance.playlists.addTracks(id, [t.id])
    await (window as unknown as StoreWindow).__resonanceStore.getState().playTracks([t], 0)
    return { id, trackId: t.id }
  })
  await page.reload()
  await page.getByTestId('playlist-item').filter({ hasText: 'Live metadata' }).click()
  const result = await page.evaluate(async ({ root, trackId }) => {
    const scan = window.resonance.library.scanPaths([root])
    const report = await window.resonance.tags.write([trackId], { title: 'Reliability Retagged' })
    await scan
    return report
  }, { root: MEDIA, trackId: info.trackId })
  expect(result.written).toBe(1)
  expect(result.rescan?.phase).toBe('done')
  await expect(page.getByTestId('track-row')).toContainText('Reliability Retagged')
  await expect(page.getByTestId('np-title')).toContainText('Reliability Retagged')
  await page.getByTestId('nav-songs').click()
  await page.getByTestId('search').fill('Reliability')
  await expect(page.getByTestId('track-row')).toHaveCount(1)
  await page.evaluate((id) => window.resonance.tags.write([id], { title: 'Changed Outside Search' }), info.trackId)
  await expect(page.getByTestId('track-row')).toHaveCount(0)
  await page.getByTestId('search').fill('')
})

test('automatic crossfade overlaps distinct signals, advances once, and defers preload', async () => {
  const ids = await playTones()
  await page.evaluate(() => (window as unknown as StoreWindow).__resonanceStore.getState().setCrossfade(2))
  await expect.poll(async () => (await snapshot()).decks.filter((d) => d.playing && d.gain > 0.05).length, { timeout: 12_000 }).toBe(2)
  const mid = await snapshot()
  expect(mid.index).toBe(1)
  expect(mid.current).toBe(ids[1])
  expect(mid.decks.map((d) => d.id).sort()).toEqual(ids.slice(0, 2).sort())
  expect(mid.signal440).toBeGreaterThan(80)
  expect(mid.signal880).toBeGreaterThan(80)
  await expect.poll(async () => (await snapshot()).decks.some((d) => d.id === ids[2]), { timeout: 5_000 }).toBe(true)
  expect((await snapshot()).index).toBe(1)
})

test('zero crossfade and repeat-one do not overlap', async () => {
  const ids = await playTones(2)
  await page.evaluate(() => (window as unknown as StoreWindow).__resonanceStore.getState().seek(7))
  await expect.poll(async () => (await snapshot()).current).toBe(ids[1])
  expect((await snapshot()).decks.filter((d) => d.playing).length).toBe(1)
  await playTones(2)
  await page.evaluate(() => {
    const s = (window as unknown as StoreWindow).__resonanceStore.getState()
    s.setCrossfade(2); s.setRepeat('one'); s.seek(7)
  })
  await expect.poll(async () => (await snapshot()).position).toBeLessThan(1)
  expect((await snapshot()).index).toBe(0)
  expect((await snapshot()).decks.filter((d) => d.playing).length).toBe(1)
})

test('end-of-track sleep mode suppresses early crossfade', async () => {
  await playTones(2)
  await page.evaluate(() => {
    const s = (window as unknown as StoreWindow).__resonanceStore.getState()
    s.setCrossfade(2); s.setSleepEndOfTrack(); s.seek(7)
  })
  await expect.poll(async () => (await snapshot()).playing).toBe(false)
  expect((await snapshot()).index).toBe(0)
})

test('shuffle and repeat-all use the exact preloaded transition at wraparound', async () => {
  await playTones()
  const expected = await page.evaluate(async () => {
    const s = (window as unknown as StoreWindow).__resonanceStore.getState()
    s.setCrossfade(2); s.setRepeat('all'); s.toggleShuffle()
    const queue = (window as unknown as StoreWindow).__resonanceStore.getState().queue
    await s.jumpTo(queue.order.at(-1)!)
    s.seek(6.2)
    const engine = (window as unknown as EngineWindow).__resonanceTestEngine
    return Object.values(engine.decks).find((d) => d.el.paused)!.trackId
  })
  await expect.poll(async () => (await snapshot()).decks.filter((d) => d.playing).length).toBe(2)
  expect((await snapshot()).current).toBe(expected)
})

test('failed incoming playback leaves the outgoing song running and falls back at its end', async () => {
  const ids = await playTones(2)
  await page.evaluate(() => {
    const s = (window as unknown as StoreWindow).__resonanceStore.getState()
    s.setCrossfade(2)
    const engine = (window as unknown as EngineWindow).__resonanceTestEngine
    const idle = Object.values(engine.decks).find((d) => d.el.paused)!
    const original = idle.el.play.bind(idle.el)
    idle.el.play = () => { idle.el.play = original; return Promise.reject(new Error('Simulated incoming failure')) }
    s.seek(6.2)
  })
  await expect.poll(() => page.evaluate(() => (window as unknown as StoreWindow).__resonanceStore.getState().error)).toContain('Simulated incoming failure')
  expect((await snapshot()).current).toBe(ids[0])
  expect((await snapshot()).playing).toBe(true)
  await expect.poll(async () => (await snapshot()).current).toBe(ids[1])
  expect((await snapshot()).playing).toBe(true)
})

test('a delayed incoming start after the outgoing end falls back and advances once', async () => {
  const ids = await playTones(2)
  await page.evaluate(() => {
    const s = (window as unknown as StoreWindow).__resonanceStore.getState()
    s.setCrossfade(2)
    const engine = (window as unknown as EngineWindow).__resonanceTestEngine
    const idle = Object.values(engine.decks).find((d) => d.el.paused)!
    const original = idle.el.play.bind(idle.el)
    idle.el.play = () => {
      idle.el.play = original
      return new Promise<void>((resolve, reject) => {
        window.setTimeout(() => { void original().then(resolve, reject) }, 700)
      })
    }
    s.seek(7.5)
  })
  await expect.poll(async () => (await snapshot()).current).toBe(ids[1])
  expect((await snapshot()).index).toBe(1)
  expect((await snapshot()).decks.filter((d) => d.playing).length).toBe(1)
  await page.waitForTimeout(1000)
  expect((await snapshot()).index).toBe(1)
})

test('short songs clamp the overlap and finish without starting a second fade', async () => {
  const first = join(MEDIA, 'short-1.wav')
  const second = join(MEDIA, 'short-2.wav')
  writeWav(first, 2, 440); writeWav(second, 2, 880)
  await page.evaluate((paths) => window.resonance.library.scanPaths(paths), [first, second])
  await page.evaluate(async (paths) => {
    const all = await window.resonance.library.getTracks()
    const tracks = paths.map((path) => all.find((t) => t.path === path)!)
    const s = (window as unknown as StoreWindow).__resonanceStore.getState()
    s.setCrossfade(12); await s.playTracks(tracks, 0)
  }, [first, second])
  await expect.poll(async () => (await snapshot()).decks.filter((d) => d.playing).length).toBe(2)
  await expect.poll(async () => (await snapshot()).playing).toBe(false)
  expect((await snapshot()).index).toBe(1)
})

for (const action of ['pause', 'seek', 'skip', 'stop'] as const) {
  test(`${action} during an overlap silences the outgoing deck and ignores stale cleanup`, async () => {
    const ids = await playTones()
    await page.evaluate(() => {
      const s = (window as unknown as StoreWindow).__resonanceStore.getState()
      s.setCrossfade(2); s.seek(6.2)
    })
    await expect.poll(async () => (await snapshot()).decks.filter((d) => d.playing).length).toBe(2)
    await page.evaluate(async (action) => {
      const s = (window as unknown as StoreWindow).__resonanceStore.getState()
      if (action === 'pause') await s.toggle()
      if (action === 'seek') s.seek(1)
      if (action === 'skip') await s.next()
      if (action === 'stop') s.stop()
    }, action)
    const state = await snapshot()
    expect(state.decks.filter((d) => d.playing).length).toBe(action === 'pause' || action === 'stop' ? 0 : 1)
    if (action === 'skip') expect(state.current).toBe(ids[2])
    if (action === 'seek') expect(state.current).toBe(ids[1])
    await page.waitForTimeout(2100)
    expect((await snapshot()).decks.filter((d) => d.playing).length).toBe(action === 'pause' || action === 'stop' ? 0 : 1)
  })
}

test('paused removal stays paused and removing the last item persists silence across quit', async () => {
  await playTones(2)
  await page.evaluate(async () => {
    const s = (window as unknown as StoreWindow).__resonanceStore.getState()
    await s.toggle(); s.removeFromQueue(0)
  })
  await expect.poll(async () => (await snapshot()).playing).toBe(false)
  await page.evaluate(async () => {
    const s = (window as unknown as StoreWindow).__resonanceStore.getState()
    await s.toggle(); s.removeFromQueue(0)
  })
  await expect.poll(async () => (await snapshot()).maxSignal).toBeLessThan(5)
  expect(await page.evaluate(() => (window as unknown as StoreWindow).__resonanceStore.getState().queue.items)).toEqual([])
  await expect.poll(() => page.evaluate(async () => (await window.resonance.settings.getAll()).session?.queue)).toEqual([])
  await app.close()
  ;({ app, page } = await launchApp(USERDATA))
  await expect(page.getByTestId('np-title')).toHaveText('Nothing playing')
  expect(await page.evaluate(() => (window as unknown as StoreWindow).__resonanceStore.getState().queue.items)).toEqual([])
  expect(existsSync(join(MEDIA, 'editable.mp3'))).toBe(true)
})
