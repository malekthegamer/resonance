import { homedir } from 'node:os'
import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { ensureFixtures, FIXTURE_DIR, fixturePaths } from '../fixtures/gen-audio'
import { launchApp } from './helpers'

/**
 * Slice 4 exit criteria (plan §A2b, §A3, §A6).
 *
 * The central risk is that playback *looks* healthy while producing silence:
 * a cross-origin media element that is not CORS-approved feeds a
 * MediaElementAudioSourceNode nothing at all, yet still reports playing and
 * still advances currentTime. Every naive assertion passes. The FFT tripwire
 * below is what actually distinguishes sound from silence.
 */

let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  ensureFixtures({ large: true })
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

/** Finds a scanned track whose path ends with the given fixture filename. */
async function trackIdByFile(suffix: string): Promise<number> {
  const id = await page.evaluate(async (s) => {
    const tracks = await window.resonance.library.getTracks()
    const hit = tracks.find((t) => t.path.toLowerCase().endsWith(s.toLowerCase()))
    return hit?.id ?? 0
  }, suffix)
  expect(id, `no scanned track for ${suffix}`).toBeGreaterThan(0)
  return id
}

/**
 * Averages analyser output over ~500 ms (§A6). A single frame is not evidence:
 * it can land on a genuinely quiet moment (false alarm) or catch a transient on
 * a broken graph (false pass — the dangerous direction).
 *
 * Measures PEAK bin magnitude, not the mean across bins. A 440 Hz sine puts
 * essentially all of its energy into one or two of 1024 bins, so the all-bin
 * mean of a full-strength tone is ~1.7 — indistinguishable from noise, and the
 * first version of this test failed for exactly that reason. Peak separates
 * cleanly: a real tone reaches ~230, true silence stays at 0.
 */
async function measureFft(trackId: number, opts: { play: boolean; atSec?: number }): Promise<number> {
  return page.evaluate(
    async ({ id, play, atSec }) => {
      const w = window as unknown as { __resonanceTestEngine?: unknown }
      const engine = w.__resonanceTestEngine as {
        load(id: number, autoplay: boolean, startAt?: number): Promise<void>
        pause(): void
        play(): Promise<void>
        analyser: AnalyserNode
        seek(s: number): void
      }

      await engine.load(id, true, atSec ?? 0)
      // Let decode and playback actually start.
      await new Promise((r) => setTimeout(r, 700))
      if (!play) engine.pause()
      await new Promise((r) => setTimeout(r, 120))

      const analyser = engine.analyser
      // Independent frames: smoothing would blur them into one another.
      const previousSmoothing = analyser.smoothingTimeConstant
      analyser.smoothingTimeConstant = 0
      const bins = new Uint8Array(analyser.frequencyBinCount)

      const framePeaks: number[] = []
      const started = performance.now()
      while (performance.now() - started < 500) {
        await new Promise((r) => requestAnimationFrame(() => r(null)))
        analyser.getByteFrequencyData(bins)
        let peak = 0
        for (let i = 0; i < bins.length; i++) if (bins[i]! > peak) peak = bins[i]!
        framePeaks.push(peak)
      }

      analyser.smoothingTimeConstant = previousSmoothing
      engine.pause()
      // Averaged across frames, so one lucky or unlucky frame cannot decide it.
      return framePeaks.reduce((a, b) => a + b, 0) / framePeaks.length
    },
    { id: trackId, play: opts.play, atSec: opts.atSec ?? 0 }
  )
}

test('SILENCE TRIPWIRE: audio actually reaches the analyser', async () => {
  // tone-440-6db.wav is 5 s of continuous -6 dBFS sine, so every 500 ms window
  // is a known-loud passage by construction. Measured at t = 1.0-1.5 s.
  const id = await trackIdByFile('tone-440-6db.wav')

  const playing = await measureFft(id, { play: true, atSec: 1.0 })
  const paused = await measureFft(id, { play: false, atSec: 1.0 })

  // eslint-disable-next-line no-console
  console.log(
    `\n=== FFT TRIPWIRE ===\nplaying peak: ${playing.toFixed(2)}\npaused  peak: ${paused.toFixed(2)}\n`
  )

  expect(playing, 'a -6 dBFS tone must produce strong FFT energy').toBeGreaterThan(100)

  // Negative control. Without it, a disconnected or misconfigured analyser
  // returning garbage would satisfy a bare "non-zero" check.
  expect(paused, 'a paused deck must produce essentially no energy').toBeLessThan(5)
  expect(playing - paused).toBeGreaterThan(95)
})

test('RANGE SEEK: seeking to 90% of a 112 MB file resumes there', async () => {
  const large = fixturePaths().large
  const bytes = statSync(large).size
  // Size is load-bearing: below a few MB Chromium buffers the whole resource and
  // never issues a Range request, so a small-file seek proves nothing.
  expect(bytes).toBeGreaterThan(100 * 1024 * 1024)

  const id = await trackIdByFile('large-tone.wav')

  const result = await page.evaluate(async (trackId) => {
    const engine = (window as never as { __resonanceTestEngine: {
      load(id: number, autoplay: boolean, startAt?: number): Promise<void>
      seek(s: number): void
      pause(): void
      play(): Promise<void>
      get position(): number
      get duration(): number
    } }).__resonanceTestEngine

    await engine.load(trackId, true)
    for (let i = 0; i < 100 && engine.duration === 0; i++) {
      await new Promise((r) => setTimeout(r, 100))
    }
    const duration = engine.duration
    const target = duration * 0.9
    engine.seek(target)

    // Wait for playback to actually resume past the seek point, rather than
    // stalling or silently restarting at zero.
    const startedWaiting = Date.now()
    let position = engine.position
    while (Date.now() - startedWaiting < 8000) {
      await new Promise((r) => setTimeout(r, 150))
      position = engine.position
      if (position > target + 0.25) break
    }
    engine.pause()
    return { duration, target, position }
  }, id)

  // eslint-disable-next-line no-console
  console.log(
    `\n=== RANGE SEEK ===\nfile   : ${(bytes / 1048576).toFixed(1)} MB\n` +
      `duration: ${result.duration.toFixed(1)}s\ntarget : ${result.target.toFixed(1)}s\n` +
      `resumed: ${result.position.toFixed(1)}s\n`
  )

  expect(result.duration).toBeGreaterThan(600)
  expect(result.position).toBeGreaterThan(result.target)
  // Not a silent restart from the beginning.
  expect(result.position).toBeGreaterThan(result.duration * 0.85)
})

test('RANGE SEEK: FLAC seeks via its seek table, a different code path from WAV', async () => {
  const id = await trackIdByFile('fixture.flac')
  const result = await page.evaluate(async (trackId) => {
    const engine = (window as never as { __resonanceTestEngine: {
      load(id: number, autoplay: boolean, startAt?: number): Promise<void>
      seek(s: number): void
      pause(): void
      get position(): number
      get duration(): number
    } }).__resonanceTestEngine

    await engine.load(trackId, true)
    for (let i = 0; i < 60 && engine.duration === 0; i++) {
      await new Promise((r) => setTimeout(r, 80))
    }
    const target = engine.duration * 0.8
    engine.seek(target)
    await new Promise((r) => setTimeout(r, 600))
    const position = engine.position
    engine.pause()
    return { duration: engine.duration, target, position }
  }, id)

  expect(result.duration).toBeGreaterThan(4)
  expect(result.position).toBeGreaterThanOrEqual(result.target - 0.2)
})

test('every required format loads and produces audio', async () => {
  const formats = ['fixture.mp3', 'fixture.flac', 'fixture.wav', 'fixture.m4a', 'fixture.ogg', 'fixture.opus']
  const results: Record<string, number> = {}

  for (const file of formats) {
    const id = await trackIdByFile(file)
    results[file] = await measureFft(id, { play: true, atSec: 1.0 })
  }

  // eslint-disable-next-line no-console
  console.log(
    '\n=== PER-FORMAT AUDIO ===\n' +
      Object.entries(results)
        .map(([f, v]) => `${f.padEnd(16)} ${v.toFixed(2)}`)
        .join('\n') +
      '\n'
  )

  for (const [file, peak] of Object.entries(results)) {
    expect(peak, `${file} produced no audible signal`).toBeGreaterThan(80)
  }
})

test('transport controls drive real playback', async () => {
  await page.getByTestId('track-row').first().dblclick()

  await expect.poll(() => page.getByTestId('np-title').textContent()).not.toBe('Nothing playing')
  await expect.poll(async () => Number(await page.evaluate(
    () => (window as never as { __resonanceTestEngine: { position: number } }).__resonanceTestEngine.position
  )), { timeout: 8000 }).toBeGreaterThan(0.3)

  await page.getByTestId('playpause').click()
  await expect
    .poll(() => page.evaluate(
      () => (window as never as { __resonanceTestEngine: { playing: boolean } }).__resonanceTestEngine.playing
    ))
    .toBe(false)

  await page.screenshot({ path: 'test-results/slice4-playing.png' })
})

test('tracks advance automatically at the end without double-skipping', async () => {
  // Start on the short tone so the end arrives quickly, then confirm exactly one
  // advance happens — the failure mode is skipping two tracks at once.
  const advanced = await page.evaluate(async () => {
    const tracks = await window.resonance.library.getTracks()
    const short = tracks.find((t) => t.path.toLowerCase().endsWith('tone-440-6db.wav'))!
    const others = tracks.filter((t) => t.id !== short.id).slice(0, 3)
    const queue = [short, ...others]

    const store = (window as never as { __resonancePlayer: {
      playTracks(t: unknown[], i: number): Promise<void>
      getState(): { queue: { index: number }; position: number }
      seek(s: number): void
    } }).__resonancePlayer
    const engine = (window as never as { __resonanceTestEngine: { duration: number } })
      .__resonanceTestEngine

    await store.playTracks(queue, 0)
    const before = store.getState().queue.index

    // Duration must be known before seeking; seek() ignores a seek issued while
    // duration is still 0, which silently made this test a no-op.
    for (let i = 0; i < 80 && engine.duration === 0; i++) {
      await new Promise((r) => setTimeout(r, 100))
    }

    // Jump near the end rather than waiting out the whole track.
    store.seek(Math.max(0, engine.duration - 0.4))
    await new Promise((r) => setTimeout(r, 4000))

    return { before, after: store.getState().queue.index }
  })

  expect(advanced.before).toBe(0)
  expect(advanced.after, 'should advance exactly one track, not two').toBe(1)
})
