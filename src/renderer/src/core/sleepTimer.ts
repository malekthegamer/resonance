/**
 * Sleep timer logic, kept pure so the arithmetic can be tested without waiting
 * real minutes for a timer to fire.
 */

export type SleepMode = 'off' | 'minutes' | 'endOfTrack'

export interface SleepTimerState {
  mode: SleepMode
  /** Epoch ms at which playback should stop; null for 'off' and 'endOfTrack'. */
  endsAt: number | null
}

export const SLEEP_OFF: SleepTimerState = { mode: 'off', endsAt: null }

export function startMinutes(minutes: number, now = Date.now()): SleepTimerState {
  const safe = Math.max(1, Math.round(minutes))
  return { mode: 'minutes', endsAt: now + safe * 60_000 }
}

export function startEndOfTrack(): SleepTimerState {
  return { mode: 'endOfTrack', endsAt: null }
}

export function remainingMs(state: SleepTimerState, now = Date.now()): number {
  if (state.mode !== 'minutes' || state.endsAt == null) return 0
  return Math.max(0, state.endsAt - now)
}

export function hasExpired(state: SleepTimerState, now = Date.now()): boolean {
  return state.mode === 'minutes' && state.endsAt != null && now >= state.endsAt
}

/** Should playback stop now that a track has finished? */
export function shouldStopAtTrackEnd(state: SleepTimerState): boolean {
  return state.mode === 'endOfTrack'
}

/** `12:05` style countdown; empty when the timer is not counting down. */
export function formatRemaining(state: SleepTimerState, now = Date.now()): string {
  if (state.mode === 'endOfTrack') return 'End of track'
  if (state.mode !== 'minutes') return ''
  const total = Math.ceil(remainingMs(state, now) / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}
