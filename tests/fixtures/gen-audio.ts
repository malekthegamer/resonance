import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, openSync, closeSync, writeSync, statSync } from 'node:fs'
import { join } from 'node:path'
import ffmpegPath from 'ffmpeg-static'

/**
 * Generates the audio fixtures the test suite needs (plan §A3).
 *
 * The user's library is MP3-only, so every non-MP3 format — and the large file
 * the range-seek test depends on — is synthesized here rather than sourced.
 * Files are written once and reused; they are gitignored.
 */

export const FIXTURE_DIR = join(process.cwd(), 'tests', 'fixtures', 'media')

/**
 * Known tag values. The scanner must read these back *exactly* through three
 * unrelated tag systems: ID3 (mp3), Vorbis comments (flac/ogg/opus), and MP4
 * atoms (m4a). Deliberately includes non-ASCII, because that is where encoding
 * bugs actually live.
 */
export const FIXTURE_TAGS = {
  title: 'Resonance Test Tone',
  artist: 'Test Artist 紅蓮',
  album: 'Fixture Album',
  album_artist: 'Fixture Album Artist',
  genre: 'Electronic',
  date: '2024',
  track: '7'
} as const

/** Seconds of tone in the small fixtures. */
const SHORT_SECONDS = 5
/** ~112 MB of uncompressed stereo 16-bit 44.1kHz audio (§A3: size is load-bearing). */
const LARGE_SECONDS = 666

const SAMPLE_RATE = 44_100
const CHANNELS = 2
const BYTES_PER_SAMPLE = 2
/** -6 dBFS — comfortably above the FFT tripwire threshold, well below clipping. */
const AMPLITUDE = 0.5012
const FREQ_HZ = 440

function ffmpeg(): string {
  if (!ffmpegPath) throw new Error('ffmpeg-static did not resolve a binary path')
  return ffmpegPath
}

function run(args: string[]): void {
  execFileSync(ffmpeg(), ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
    stdio: ['ignore', 'pipe', 'pipe']
  })
}

/**
 * Writes a WAV of `seconds` directly, in chunks.
 *
 * Pure JS on purpose: WAV needs no encoder, and the large fixture must not be
 * built in memory — 112 MB of Int16 would be a needless allocation spike.
 */
export function writeWav(path: string, seconds: number): void {
  const dataBytes = SAMPLE_RATE * CHANNELS * BYTES_PER_SAMPLE * seconds
  const fd = openSync(path, 'w')
  try {
    const header = Buffer.alloc(44)
    header.write('RIFF', 0, 'ascii')
    header.writeUInt32LE(36 + dataBytes, 4)
    header.write('WAVE', 8, 'ascii')
    header.write('fmt ', 12, 'ascii')
    header.writeUInt32LE(16, 16) // PCM chunk size
    header.writeUInt16LE(1, 20) // format = PCM
    header.writeUInt16LE(CHANNELS, 22)
    header.writeUInt32LE(SAMPLE_RATE, 24)
    header.writeUInt32LE(SAMPLE_RATE * CHANNELS * BYTES_PER_SAMPLE, 28) // byte rate
    header.writeUInt16LE(CHANNELS * BYTES_PER_SAMPLE, 32) // block align
    header.writeUInt16LE(16, 34) // bits per sample
    header.write('data', 36, 'ascii')
    header.writeUInt32LE(dataBytes, 40)
    writeSync(fd, header)

    const framesPerChunk = SAMPLE_RATE // one second at a time
    const chunk = Buffer.alloc(framesPerChunk * CHANNELS * BYTES_PER_SAMPLE)
    let frame = 0
    const totalFrames = SAMPLE_RATE * seconds

    while (frame < totalFrames) {
      const frames = Math.min(framesPerChunk, totalFrames - frame)
      for (let i = 0; i < frames; i++) {
        const sample = Math.round(
          Math.sin((2 * Math.PI * FREQ_HZ * (frame + i)) / SAMPLE_RATE) * AMPLITUDE * 32767
        )
        const off = i * CHANNELS * BYTES_PER_SAMPLE
        chunk.writeInt16LE(sample, off)
        chunk.writeInt16LE(sample, off + 2)
      }
      writeSync(fd, chunk, 0, frames * CHANNELS * BYTES_PER_SAMPLE)
      frame += frames
    }
  } finally {
    closeSync(fd)
  }
}

function tagArgs(): string[] {
  return Object.entries(FIXTURE_TAGS).flatMap(([k, v]) => ['-metadata', `${k}=${v}`])
}

export interface Fixtures {
  tone: string
  large: string
  cover: string
  byFormat: Record<string, string>
}

export function fixturePaths(): Fixtures {
  const f = (n: string): string => join(FIXTURE_DIR, n)
  return {
    tone: f('tone-440-6db.wav'),
    large: f('large-tone.wav'),
    cover: f('cover.jpg'),
    byFormat: {
      wav: f('fixture.wav'),
      flac: f('fixture.flac'),
      m4a: f('fixture.m4a'),
      ogg: f('fixture.ogg'),
      opus: f('fixture.opus'),
      mp3: f('fixture.mp3')
    }
  }
}

/** Idempotent: existing non-empty fixtures are reused, so reruns are fast. */
export function ensureFixtures(opts: { large?: boolean } = {}): Fixtures {
  mkdirSync(FIXTURE_DIR, { recursive: true })
  const p = fixturePaths()

  const missing = (path: string, minBytes = 1024): boolean =>
    !existsSync(path) || statSync(path).size < minBytes

  // Bare tone for the FFT tripwire (§A6) — no tags, nothing to interfere.
  if (missing(p.tone)) writeWav(p.tone, SHORT_SECONDS)

  // Cover art, so the scanner's artwork extraction has something real to find.
  if (missing(p.cover, 100)) {
    run([
      '-f', 'lavfi',
      '-i', 'color=c=0x4f7cff:s=320x320',
      '-frames:v', '1',
      p.cover
    ])
  }

  // Tagged WAV. Written raw first, then rewritten through ffmpeg so it carries a
  // RIFF INFO chunk — otherwise there is nothing for the scanner to read back.
  const wav = p.byFormat['wav']!
  if (missing(wav)) {
    run(['-i', p.tone, '-c:a', 'pcm_s16le', ...tagArgs(), wav])
  }

  const encodings: Array<[string, string[]]> = [
    ['flac', ['-c:a', 'flac']],
    ['m4a', ['-c:a', 'aac', '-b:a', '192k']],
    ['ogg', ['-c:a', 'libvorbis', '-b:a', '192k']],
    ['opus', ['-c:a', 'libopus', '-b:a', '128k']],
    ['mp3', ['-c:a', 'libmp3lame', '-b:a', '320k']]
  ]

  for (const [ext, codecArgs] of encodings) {
    const out = p.byFormat[ext]!
    if (!missing(out)) continue
    // Cover art is attached only where the container supports it. Opus and Ogg
    // carry pictures as base64 METADATA_BLOCK_PICTURE, which ffmpeg does not
    // write; attaching there would fail the whole generation step.
    //
    // '-c:v copy' is required: without an explicit video codec ffmpeg re-encodes
    // the attached picture using the container default, which for MP4 is H.264 —
    // and an H.264 stream is not a valid cover image.
    const withCover = ext === 'flac' || ext === 'mp3' || ext === 'm4a'
    run([
      '-i', p.tone,
      ...(withCover ? ['-i', p.cover] : []),
      ...(withCover
        ? ['-map', '0:a', '-map', '1:v', '-c:v', 'copy', '-disposition:v', 'attached_pic']
        : []),
      ...codecArgs,
      ...tagArgs(),
      out
    ])
  }

  if (opts.large && missing(p.large, 100 * 1024 * 1024)) {
    writeWav(p.large, LARGE_SECONDS)
  }

  return p
}

/** Size report, used by the fixture test to print real evidence. */
export function describeFixtures(p: Fixtures, includeLarge: boolean): string[] {
  const files = [p.tone, p.cover, ...Object.values(p.byFormat), ...(includeLarge ? [p.large] : [])]
  return files.map((file) => {
    const size = existsSync(file) ? statSync(file).size : 0
    return `${(size / 1048576).toFixed(2).padStart(9)} MB  ${file.replace(FIXTURE_DIR, '')}`
  })
}
