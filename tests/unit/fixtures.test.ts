import { statSync } from 'node:fs'
import { describe, expect, it, beforeAll } from 'vitest'
import { parseFile } from 'music-metadata'
import {
  describeFixtures,
  ensureFixtures,
  FIXTURE_TAGS,
  type Fixtures
} from '../fixtures/gen-audio'

/**
 * Plan §A3. The user's library is MP3-only, so every other required format is
 * generated here. This suite proves the fixtures are genuinely encoded and that
 * tags survive three unrelated tag systems — it is the evidence behind any
 * claim that Resonance supports these formats.
 *
 * The ~112 MB fixture is generated only when RESONANCE_LARGE_FIXTURE=1, so the
 * everyday unit run stays fast. Slice 4's range-seek test sets it.
 */

const WANT_LARGE = process.env['RESONANCE_LARGE_FIXTURE'] === '1'

let f: Fixtures

beforeAll(() => {
  f = ensureFixtures({ large: WANT_LARGE })
  // eslint-disable-next-line no-console
  console.log('\nGenerated fixtures:\n' + describeFixtures(f, WANT_LARGE).join('\n'))
}, 240_000)

describe('generated audio fixtures', () => {
  it('produces a real file for every format the spec requires', () => {
    for (const [ext, path] of Object.entries(f.byFormat)) {
      expect(statSync(path).size, `${ext} fixture should not be empty`).toBeGreaterThan(1024)
    }
  })

  // Container/codec is read from the decoded stream, not the file extension —
  // otherwise this would only prove ffmpeg can rename files.
  // Opus is always 48 kHz — the codec mandates it regardless of input rate, so
  // the expected value differs there by spec, not by accident.
  it.each([
    ['flac', /flac/i, 44_100],
    ['m4a', /aac|mp4a/i, 44_100],
    ['ogg', /vorbis/i, 44_100],
    ['opus', /opus/i, 48_000],
    ['mp3', /mpeg|mp3/i, 44_100],
    ['wav', /pcm/i, 44_100]
  ])('%s is genuinely encoded, not just named that way', async (ext, codecPattern, rate) => {
    const meta = await parseFile(f.byFormat[ext as string]!)
    expect(meta.format.codec ?? meta.format.container ?? '').toMatch(codecPattern as RegExp)
    expect(meta.format.duration ?? 0).toBeGreaterThan(4)
    expect(meta.format.sampleRate).toBe(rate)
  })

  // The real point of the exercise: ID3, Vorbis comments and MP4 atoms are
  // unrelated formats, and album-artist in particular is where normalization
  // quietly differs between them.
  it.each(['flac', 'm4a', 'ogg', 'opus', 'mp3'])(
    'round-trips tags through %s, including non-ASCII',
    async (ext) => {
      const { common } = await parseFile(f.byFormat[ext]!)
      expect(common.title).toBe(FIXTURE_TAGS.title)
      expect(common.artist).toBe(FIXTURE_TAGS.artist)
      expect(common.album).toBe(FIXTURE_TAGS.album)
      expect(common.genre?.[0]).toBe(FIXTURE_TAGS.genre)
      expect(String(common.year ?? '')).toBe(FIXTURE_TAGS.date)
      expect(String(common.track?.no ?? '')).toBe(FIXTURE_TAGS.track)
    }
  )

  it('embeds cover art where the container supports it', async () => {
    for (const ext of ['flac', 'm4a', 'mp3']) {
      const { common } = await parseFile(f.byFormat[ext]!)
      expect(common.picture?.length, `${ext} should carry a picture`).toBeGreaterThan(0)
      expect(common.picture![0]!.data.length).toBeGreaterThan(100)
    }
  })

  it.runIf(WANT_LARGE)(
    'generates a file large enough that Chromium must stream rather than buffer it',
    () => {
      const bytes = statSync(f.large).size
      expect(bytes).toBeGreaterThan(100 * 1024 * 1024)
    }
  )
})
