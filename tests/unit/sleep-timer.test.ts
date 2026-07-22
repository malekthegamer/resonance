import { describe, expect, it } from 'vitest'
import {
  formatRemaining,
  hasExpired,
  remainingMs,
  shouldStopAtTrackEnd,
  SLEEP_OFF,
  startEndOfTrack,
  startMinutes
} from '@renderer/core/sleepTimer'

const T0 = 1_700_000_000_000

describe('sleep timer', () => {
  it('is inert when off', () => {
    expect(hasExpired(SLEEP_OFF, T0)).toBe(false)
    expect(remainingMs(SLEEP_OFF, T0)).toBe(0)
    expect(shouldStopAtTrackEnd(SLEEP_OFF)).toBe(false)
  })

  it('counts down from the requested minutes', () => {
    const state = startMinutes(30, T0)
    expect(remainingMs(state, T0)).toBe(30 * 60_000)
    expect(remainingMs(state, T0 + 10 * 60_000)).toBe(20 * 60_000)
  })

  it('expires exactly at the deadline, not a tick late', () => {
    const state = startMinutes(1, T0)
    expect(hasExpired(state, T0 + 59_999)).toBe(false)
    expect(hasExpired(state, T0 + 60_000)).toBe(true)
    expect(hasExpired(state, T0 + 120_000)).toBe(true)
  })

  it('never reports negative time remaining', () => {
    expect(remainingMs(startMinutes(5, T0), T0 + 999_999)).toBe(0)
  })

  // A zero or negative duration would otherwise stop playback instantly.
  it('clamps nonsensical durations to at least a minute', () => {
    expect(remainingMs(startMinutes(0, T0), T0)).toBe(60_000)
    expect(remainingMs(startMinutes(-10, T0), T0)).toBe(60_000)
  })

  it('end-of-track mode stops at the next track end, not on a clock', () => {
    const state = startEndOfTrack()
    expect(shouldStopAtTrackEnd(state)).toBe(true)
    expect(hasExpired(state, T0 + 999_999_999)).toBe(false)
  })

  it('formats a readable countdown', () => {
    const state = startMinutes(30, T0)
    expect(formatRemaining(state, T0)).toBe('30:00')
    expect(formatRemaining(state, T0 + 29 * 60_000 + 55_000)).toBe('0:05')
    expect(formatRemaining(startEndOfTrack())).toBe('End of track')
    expect(formatRemaining(SLEEP_OFF)).toBe('')
  })
})
