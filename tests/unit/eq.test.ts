import { describe, expect, it } from 'vitest'
import { EQ_BAND_COUNT, EQ_FREQUENCIES, EQ_MAX_GAIN_DB } from '@renderer/audio/engine'
import {
  bandLabel,
  BUILT_IN_PRESETS,
  clampGain,
  findPreset,
  FLAT_GAINS,
  isFlat,
  normalizeGains
} from '@renderer/audio/equalizer'

describe('band frequencies', () => {
  it('matches the ten frequencies the spec names', () => {
    expect([...EQ_FREQUENCIES]).toEqual([31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000])
    expect(EQ_BAND_COUNT).toBe(10)
  })

  it('labels kilohertz bands compactly', () => {
    expect(bandLabel(0)).toBe('31')
    expect(bandLabel(5)).toBe('1k')
    expect(bandLabel(9)).toBe('16k')
  })
})

describe('presets', () => {
  it('every preset defines exactly ten bands', () => {
    for (const preset of BUILT_IN_PRESETS) {
      expect(preset.gains, `${preset.name} band count`).toHaveLength(EQ_BAND_COUNT)
    }
  })

  it('no preset exceeds the ±12 dB range', () => {
    for (const preset of BUILT_IN_PRESETS) {
      for (const gain of preset.gains) {
        expect(Math.abs(gain), `${preset.name} has an out-of-range band`).toBeLessThanOrEqual(
          EQ_MAX_GAIN_DB
        )
      }
    }
  })

  it('includes the shapes the spec asks for', () => {
    const names = BUILT_IN_PRESETS.map((p) => p.name)
    for (const required of ['Flat', 'Bass Boost', 'Treble Boost', 'Vocal', 'Rock', 'Pop', 'Electronic']) {
      expect(names).toContain(required)
    }
  })

  it('Flat is actually flat', () => {
    expect(isFlat(BUILT_IN_PRESETS.find((p) => p.name === 'Flat')!.gains)).toBe(true)
  })

  it('Bass Boost lifts lows and leaves highs alone', () => {
    const bass = BUILT_IN_PRESETS.find((p) => p.name === 'Bass Boost')!.gains
    expect(bass[0]!).toBeGreaterThan(3)
    expect(bass[1]!).toBeGreaterThan(3)
    expect(bass[9]!).toBe(0)
  })

  it('Treble Boost lifts highs and leaves lows alone', () => {
    const treble = BUILT_IN_PRESETS.find((p) => p.name === 'Treble Boost')!.gains
    expect(treble[9]!).toBeGreaterThan(3)
    expect(treble[0]!).toBe(0)
  })

  // A preset that boosts everything is a volume change with extra distortion.
  it('no preset is a pure across-the-board boost', () => {
    for (const preset of BUILT_IN_PRESETS) {
      if (isFlat(preset.gains)) continue
      const allPositive = preset.gains.every((g) => g > 0)
      expect(allPositive, `${preset.name} boosts every band`).toBe(false)
    }
  })
})

describe('gain clamping', () => {
  it('bounds to the documented range', () => {
    expect(clampGain(99)).toBe(EQ_MAX_GAIN_DB)
    expect(clampGain(-99)).toBe(-EQ_MAX_GAIN_DB)
    expect(clampGain(6)).toBe(6)
  })

  // A NaN reaching an AudioParam throws and silences the graph.
  it('absorbs NaN rather than passing it to an AudioParam', () => {
    expect(clampGain(NaN)).toBe(0)
    expect(clampGain(Infinity)).toBe(EQ_MAX_GAIN_DB)
  })
})

describe('normalizeGains — tolerating stored settings', () => {
  it('accepts a well-formed array', () => {
    const gains = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    expect(normalizeGains(gains)).toEqual(gains)
  })

  it('pads a short array instead of leaving holes', () => {
    expect(normalizeGains([3, 3])).toEqual([3, 3, 0, 0, 0, 0, 0, 0, 0, 0])
  })

  it('truncates a long array', () => {
    expect(normalizeGains(new Array(30).fill(2))).toHaveLength(EQ_BAND_COUNT)
  })

  it('falls back to flat for junk', () => {
    expect(normalizeGains(null)).toEqual(FLAT_GAINS)
    expect(normalizeGains('nope')).toEqual(FLAT_GAINS)
    expect(normalizeGains([NaN, 'x', undefined])).toEqual(FLAT_GAINS)
  })

  it('clamps out-of-range stored values', () => {
    expect(normalizeGains([100, -100])[0]).toBe(EQ_MAX_GAIN_DB)
    expect(normalizeGains([100, -100])[1]).toBe(-EQ_MAX_GAIN_DB)
  })
})

describe('findPreset', () => {
  it('identifies the matching preset for a curve', () => {
    const rock = BUILT_IN_PRESETS.find((p) => p.name === 'Rock')!
    expect(findPreset(BUILT_IN_PRESETS, rock.gains)).toBe('Rock')
  })

  it('returns null once the curve is edited', () => {
    const rock = [...BUILT_IN_PRESETS.find((p) => p.name === 'Rock')!.gains]
    rock[3] = rock[3]! + 2
    expect(findPreset(BUILT_IN_PRESETS, rock)).toBeNull()
  })
})
