/**
 * Pure formatting helpers. Kept free of React and of any browser API so they can
 * be unit-tested directly — playback time display is the kind of thing that is
 * quietly wrong at edge values (negative seek deltas, NaN duration before
 * metadata loads, tracks over an hour) and never noticed until it is.
 */

/** `m:ss`, or `h:mm:ss` past an hour. Non-finite/negative input renders as `0:00`. */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '0:00'

  const total = Math.floor(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60

  const ss = String(s).padStart(2, '0')
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${ss}`
  return `${m}:${ss}`
}

/** `320 kbps`, or empty string when unknown. music-metadata reports bits/sec. */
export function formatBitrate(bitsPerSecond: number | null | undefined): string {
  if (bitsPerSecond == null || !Number.isFinite(bitsPerSecond) || bitsPerSecond <= 0) return ''
  return `${Math.round(bitsPerSecond / 1000)} kbps`
}

export function formatFileSize(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return ''
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`
}

/** Clamp used by seek and volume; guards against NaN reaching the audio graph. */
export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}
