import { describe, expect, it } from 'vitest'
import {
  clamp,
  formatBitrate,
  formatDuration,
  formatFileSize
} from '@renderer/core/format'

describe('formatDuration', () => {
  it('formats sub-minute durations with a padded seconds field', () => {
    expect(formatDuration(0)).toBe('0:00')
    expect(formatDuration(7)).toBe('0:07')
    expect(formatDuration(59)).toBe('0:59')
  })

  it('rolls over to minutes and hours', () => {
    expect(formatDuration(60)).toBe('1:00')
    expect(formatDuration(241)).toBe('4:01')
    expect(formatDuration(3600)).toBe('1:00:00')
    expect(formatDuration(3671)).toBe('1:01:11')
  })

  it('truncates rather than rounds, so the display never shows a time not yet reached', () => {
    expect(formatDuration(59.9)).toBe('0:59')
    expect(formatDuration(3599.99)).toBe('59:59')
  })

  // These are the values that actually reach this function in practice: an
  // <audio> element reports NaN duration until metadata loads, and seek deltas
  // can transiently go negative.
  it('degrades safely on the values a media element really produces', () => {
    expect(formatDuration(NaN)).toBe('0:00')
    expect(formatDuration(Infinity)).toBe('0:00')
    expect(formatDuration(-5)).toBe('0:00')
    expect(formatDuration(null)).toBe('0:00')
    expect(formatDuration(undefined)).toBe('0:00')
  })
})

describe('formatBitrate', () => {
  it('converts bits per second to kbps', () => {
    expect(formatBitrate(320000)).toBe('320 kbps')
    expect(formatBitrate(128000)).toBe('128 kbps')
  })

  it('returns empty string when unknown rather than a misleading zero', () => {
    expect(formatBitrate(0)).toBe('')
    expect(formatBitrate(null)).toBe('')
    expect(formatBitrate(NaN)).toBe('')
  })
})

describe('formatFileSize', () => {
  it('scales through units', () => {
    expect(formatFileSize(512)).toBe('512 B')
    expect(formatFileSize(2048)).toBe('2 KB')
    expect(formatFileSize(5 * 1024 * 1024)).toBe('5.0 MB')
    expect(formatFileSize(120 * 1024 * 1024)).toBe('120 MB')
  })
})

describe('clamp', () => {
  it('bounds values', () => {
    expect(clamp(0.5, 0, 1)).toBe(0.5)
    expect(clamp(-2, 0, 1)).toBe(0)
    expect(clamp(9, 0, 1)).toBe(1)
  })

  // A NaN reaching a GainNode or currentTime throws or silences audio, so the
  // clamp must absorb it rather than pass it through.
  it('absorbs NaN to the minimum instead of propagating it into the audio graph', () => {
    expect(clamp(NaN, 0, 1)).toBe(0)
  })
})
