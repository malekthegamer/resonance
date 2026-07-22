import { create } from 'zustand'
import type { Track } from '@shared/types'
import { AudioEngine } from '../audio/engine'
import {
  addToQueue as qAdd,
  cycleRepeat as qCycleRepeat,
  currentTrackId,
  EMPTY_QUEUE,
  jumpTo as qJumpTo,
  move as qMove,
  next as qNext,
  peekNext,
  playNext as qPlayNext,
  previous as qPrevious,
  removeAt as qRemoveAt,
  setQueue as qSetQueue,
  setShuffle as qSetShuffle,
  type QueueState,
  type RepeatMode
} from '../core/queue'

interface PlayerState {
  queue: QueueState
  current: Track | null
  playing: boolean
  position: number
  duration: number
  buffered: Array<[number, number]>
  volume: number
  muted: boolean
  error: string | null
  /** Track id -> Track, so the queue can render without re-querying. */
  known: Map<number, Track>

  init(): void
  playTracks(tracks: Track[], startIndex: number): Promise<void>
  toggle(): Promise<void>
  stop(): void
  next(auto?: boolean): Promise<void>
  previous(): Promise<void>
  seek(sec: number): void
  seekFraction(f: number): void
  setVolume(v: number): void
  toggleMute(): void
  toggleShuffle(): void
  cycleRepeat(): void
  setRepeat(mode: RepeatMode): void
  playNext(tracks: Track[]): void
  addToQueue(tracks: Track[]): void
  removeFromQueue(index: number): void
  moveInQueue(from: number, to: number): void
  jumpTo(index: number): Promise<void>
  clearError(): void
}

let engine: AudioEngine | null = null

/** Exposed for the EQ and visualizer, which need the live graph. */
export function getEngine(): AudioEngine | null {
  return engine
}

export const usePlayer = create<PlayerState>((set, get) => {
  function remember(tracks: Track[]): Map<number, Track> {
    const known = new Map(get().known)
    for (const t of tracks) known.set(t.id, t)
    return known
  }

  function syncCurrent(queue: QueueState): Track | null {
    const id = currentTrackId(queue)
    return id == null ? null : (get().known.get(id) ?? null)
  }

  /** Loads whatever the queue now points at and preloads what follows. */
  async function activate(queue: QueueState, restart: boolean): Promise<void> {
    const id = currentTrackId(queue)
    if (id == null || !engine) return

    if (restart) {
      engine.seek(0)
      await engine.play()
    } else {
      await engine.load(id, true)
    }
    engine.preload(peekNext(queue))
    set({ current: get().known.get(id) ?? null, error: null })
  }

  return {
    queue: EMPTY_QUEUE,
    current: null,
    playing: false,
    position: 0,
    duration: 0,
    buffered: [],
    volume: 1,
    muted: false,
    error: null,
    known: new Map(),

    init() {
      if (engine) return
      engine = new AudioEngine({
        onTimeUpdate: (position, duration) => set({ position, duration }),
        onEnded: () => void get().next(true),
        onPlayingChanged: (playing) => set({ playing }),
        onError: (error) => set({ error }),
        onBuffered: (buffered) => set({ buffered })
      })
      engine.setVolume(get().volume)

      // Test hooks. The e2e suite must drive the real graph to prove audio is
      // actually reaching the analyser — asserting through the UI alone cannot
      // distinguish playing from silently-playing-nothing. These expose objects
      // that already live in the renderer, so no security boundary changes.
      const w = window as unknown as Record<string, unknown>
      w['__resonanceTestEngine'] = engine
      w['__resonancePlayer'] = {
        playTracks: (tracks: Track[], index: number) => get().playTracks(tracks, index),
        seek: (sec: number) => get().seek(sec),
        getState: () => ({ queue: get().queue, position: get().position })
      }
    },

    async playTracks(tracks, startIndex) {
      if (tracks.length === 0) return
      get().init()
      const known = remember(tracks)
      const queue = qSetQueue(
        tracks.map((t) => t.id),
        startIndex,
        get().queue
      )
      set({ known, queue })
      await activate(queue, false)
    },

    async toggle() {
      get().init()
      if (!get().current) return
      await engine!.toggle()
    },

    stop() {
      engine?.stop()
      set({ position: 0 })
    },

    async next(auto = false) {
      const result = qNext(get().queue, auto)
      set({ queue: result.state, current: syncCurrent(result.state) })

      if (!result.playing) {
        engine?.pause()
        engine?.seek(0)
        return
      }
      await activate(result.state, result.restart)
    },

    async previous() {
      const result = qPrevious(get().queue, get().position * 1000)
      set({ queue: result.state, current: syncCurrent(result.state) })
      await activate(result.state, result.restart)
    },

    seek(sec) {
      engine?.seek(sec)
      set({ position: sec })
    },

    seekFraction(f) {
      engine?.seekFraction(f)
    },

    setVolume(v) {
      engine?.setVolume(v)
      // Adjusting volume implicitly unmutes; leaving it muted looks broken.
      if (v > 0 && get().muted) {
        engine?.setMuted(false)
        set({ muted: false })
      }
      set({ volume: v })
    },

    toggleMute() {
      const muted = !get().muted
      engine?.setMuted(muted)
      set({ muted })
    },

    toggleShuffle() {
      const queue = qSetShuffle(get().queue, !get().queue.shuffle)
      set({ queue })
      engine?.preload(peekNext(queue))
    },

    cycleRepeat() {
      const queue = qCycleRepeat(get().queue)
      set({ queue })
      engine?.preload(peekNext(queue))
    },

    setRepeat(mode) {
      set({ queue: { ...get().queue, repeat: mode } })
    },

    playNext(tracks) {
      if (tracks.length === 0) return
      const known = remember(tracks)
      const queue = qPlayNext(get().queue, tracks.map((t) => t.id))
      set({ known, queue })
      engine?.preload(peekNext(queue))
    },

    addToQueue(tracks) {
      if (tracks.length === 0) return
      const known = remember(tracks)
      const queue = qAdd(get().queue, tracks.map((t) => t.id))
      set({ known, queue })
      engine?.preload(peekNext(queue))
    },

    removeFromQueue(index) {
      const wasCurrent = index === get().queue.index
      const queue = qRemoveAt(get().queue, index)
      set({ queue, current: syncCurrent(queue) })
      if (wasCurrent && currentTrackId(queue) != null) void activate(queue, false)
    },

    moveInQueue(from, to) {
      const queue = qMove(get().queue, from, to)
      set({ queue })
      engine?.preload(peekNext(queue))
    },

    async jumpTo(index) {
      const queue = qJumpTo(get().queue, index)
      set({ queue, current: syncCurrent(queue) })
      await activate(queue, false)
    },

    clearError() {
      set({ error: null })
    }
  }
})
