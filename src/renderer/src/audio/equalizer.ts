import { EQ_BAND_COUNT, EQ_FREQUENCIES, EQ_MAX_GAIN_DB } from './engine'

/**
 * Ten-band graphic equalizer presets.
 *
 * Gains are in dB, ordered to match EQ_FREQUENCIES (31 Hz … 16 kHz). Presets are
 * deliberately conservative: a preset that clips is worse than one that is
 * subtle, and boosting every band is just a volume increase with extra
 * distortion, so shapes are cuts as well as boosts.
 */

export interface EqPreset {
  name: string
  gains: number[]
  builtIn: boolean
}

function preset(name: string, gains: number[]): EqPreset {
  if (gains.length !== EQ_BAND_COUNT) {
    throw new Error(`Preset ${name} must define ${EQ_BAND_COUNT} bands`)
  }
  return { name, gains, builtIn: true }
}

//                          31   62  125  250  500   1k   2k   4k   8k  16k
export const BUILT_IN_PRESETS: EqPreset[] = [
  preset('Flat',        [  0,   0,   0,   0,   0,   0,   0,   0,   0,   0]),
  preset('Bass Boost',  [  6,   5,   4, 2.5,   0,   0,   0,   0,   0,   0]),
  preset('Bass Cut',    [ -6,  -5,  -4,  -2,   0,   0,   0,   0,   0,   0]),
  preset('Treble Boost',[  0,   0,   0,   0,   0,   1, 2.5,   4,   5,   6]),
  preset('Vocal',       [ -2,  -2,  -1,   1,   3,   4,   3,   1,   0,  -1]),
  preset('Rock',        [  4,   3,  -1,  -2,  -1,   1,   2, 3.5,   4,   4]),
  preset('Pop',         [ -1,   0,   1,   2, 3.5,   3,   1,   0,  -1,  -1]),
  preset('Electronic',  [  5,   4,   1,   0,  -1,   1,   0,   2,   4,   5]),
  preset('Jazz',        [  3,   2,   1,   2,  -1,  -1,   0,   1,   2,   3]),
  preset('Classical',   [  3,   2,   0,   0,   0,   0,  -1,  -1,  -1,  -2]),
  preset('Loudness',    [  5,   4,   1,   0,  -2,   0,   1,   3,   4,   5])
]

export const FLAT_GAINS: number[] = new Array(EQ_BAND_COUNT).fill(0)

/** Human-readable band label: 31, 125, 1k, 16k. */
export function bandLabel(index: number): string {
  const hz = EQ_FREQUENCIES[index] ?? 0
  return hz >= 1000 ? `${hz / 1000}k` : String(hz)
}

export function clampGain(db: number): number {
  // NaN has no meaningful magnitude, so it becomes 0 (flat). Infinity does —
  // it means "as far as possible" — so it clamps to the range end. Collapsing
  // both to 0 would silently discard a legitimate maximum.
  if (Number.isNaN(db)) return 0
  return Math.min(EQ_MAX_GAIN_DB, Math.max(-EQ_MAX_GAIN_DB, db))
}

/** Normalizes stored gains, tolerating a stale array of the wrong length. */
export function normalizeGains(gains: unknown): number[] {
  if (!Array.isArray(gains)) return [...FLAT_GAINS]
  const out = [...FLAT_GAINS]
  for (let i = 0; i < EQ_BAND_COUNT; i++) {
    const value = gains[i]
    out[i] = typeof value === 'number' ? clampGain(value) : 0
  }
  return out
}

export function findPreset(presets: EqPreset[], gains: number[]): string | null {
  const match = presets.find((p) => p.gains.every((g, i) => Math.abs(g - (gains[i] ?? 0)) < 0.05))
  return match?.name ?? null
}

export function isFlat(gains: number[]): boolean {
  return gains.every((g) => Math.abs(g) < 0.05)
}
