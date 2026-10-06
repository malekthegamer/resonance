import { create } from 'zustand'
import type { Track } from '@shared/types'
import { AudioEngine } from '../audio/engine'
import {
  shouldStopAtTrackEnd,
  SLEEP_OFF,
  startEndOfTrack,
  startMinutes,
  type SleepTimerState
} from '../core/sleepTimer'
import {
  addToQueue as qAdd,
  cycleRepeat as qCycleRepeat,
  currentTrackId,
  EMPTY_QUEUE,
  jumpTo as qJumpTo,
  move as qMove,
  next as qNext,
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
  crossfadeSec: number
  sleep: SleepTimerState
  /** True once a saved session has been restored, so it happens only once. */
  sessionRestored: boolean

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
  setCrossfade(seconds: number): void
  setSleepMinutes(minutes: number): void
  setSleepEndOfTrack(): void
  cancelSleep(): void
  restoreSession(): Promise<void>
  persistSession(): void
  refreshKnown(tracks: Track[]): void
}

let engine: AudioEngine | null = null

/** Exposed for the EQ and visualizer, which need the live graph. */
export function getEngine(): AudioEngine | null {
  return engine
}

export const usePlayer = create<PlayerState>((set, get) => {
  let prepared: { queue: QueueState; result: ReturnType<typeof qNext> } | null = null
  let transitionEpoch = 0
  let transitioning = false
  let fadeAttemptedFor: QueueState | null = null
  let endedWhileTransitioning = false
  let restoringSession = false

  function invalidateTransition(): void {
    transitionEpoch++
    if (transitioning) engine?.cancelTransition()
    transitioning = false
    fadeAttemptedFor = null
    prepared = null
    endedWhileTransitioning = false
  }

  function nextTransition(): ReturnType<typeof qNext> {
    const queue = get().queue
    if (prepared?.queue !== queue) prepared = { queue, result: qNext(queue, true) }
    return prepared.result
  }

  function preloadNext(): void {
    const result = nextTransition()
    engine?.preload(result.playing ? currentTrackId(result.state) : null)
  }

  async function maybeCrossfade(position: number, duration: number): Promise<void> {
    const s = get()
    if (!engine || transitioning || fadeAttemptedFor === s.queue || !engine.playing || s.crossfadeSec <= 0 || s.queue.repeat === 'one' || shouldStopAtTrackEnd(s.sleep)) return
    const result = nextTransition()
    const id = currentTrackId(result.state)
    if (!result.playing || result.restart || id == null) return
    const overlap = Math.min(s.crossfadeSec, duration / 2, (s.known.get(id)?.duration ?? 0) / 2)
    if (overlap <= 0 || duration - position > overlap || duration - position <= 0) return
    if (!engine.canCrossfadeTo(id)) return
    transitioning = true
    fadeAttemptedFor = s.queue
    const token = transitionEpoch
    let started = false
    try {
      started = await engine.crossfadeTo(id, overlap)
      if (!started || token !== transitionEpoch || get().queue !== s.queue) return
      set({ queue: result.state, current: syncCurrent(result.state), position: engine.position, duration: engine.duration, buffered: [] })
      prepared = null
      preloadNext()
      get().persistSession()
    } finally {
      if (token === transitionEpoch) {
        transitioning = false
        if (endedWhileTransitioning && !started) { endedWhileTransitioning = false; void get().next(true) }
      }
    }
  }

  function remember(tracks: Track[]): Map<number, Track> {
    const known = new Map(get().known)
    for (const t of tracks) known.set(t.id, t)
    return known
  }

  function syncCurrent(queue: QueueState): Track | null {
    const id = currentTrackId(queue)
    return id == null ? null : (get().known.get(id) ?? null)
  }

  /**
   * Loads whatever the queue now points at and preloads what follows.
   *
   * Ended transitions are ordinary loads; overlap is scheduled before the end.
   */
  async function activate(queue: QueueState, restart: boolean, autoplay = true): Promise<void> {
    const id = currentTrackId(queue)
    if (id == null || !engine) return
    set({ error: null })

    if (restart) {
      engine.seek(0)
      if (autoplay) await engine.play()
    } else {
      await engine.load(id, autoplay)
    }
    preloadNext()
    set({ current: get().known.get(id) ?? null })
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
    crossfadeSec: 0,
    sleep: SLEEP_OFF,
    sessionRestored: false,

    init() {
      if (engine) return
      engine = new AudioEngine({
        onTimeUpdate: (position, duration) => {
          set({ position, duration })
          void maybeCrossfade(position, duration)
        },
        onEnded: () => {
          // The sleep timer's "end of track" mode stops here rather than
          // advancing, which is the whole point of that mode.
          if (shouldStopAtTrackEnd(get().sleep)) {
            engine?.pause()
            set({ sleep: SLEEP_OFF })
            return
          }
          void get().next(true)
        },
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
      // Full store access for the session/timer tests, which need actions the
      // narrow test shim above does not expose.
      w['__resonanceStore'] = usePlayer
      w['__resonancePlayer'] = {
        playTracks: (tracks: Track[], index: number) => get().playTracks(tracks, index),
        seek: (sec: number) => get().seek(sec),
        getState: () => ({ queue: get().queue, position: get().position })
      }
    },

    async playTracks(tracks, startIndex) {
      if (tracks.length === 0) return
      get().init()
      invalidateTransition()
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
      invalidateTransition()
      await engine!.toggle()
      preloadNext()
    },

    stop() {
      invalidateTransition()
      engine?.stop()
      set({ position: 0 })
      get().persistSession()
    },

    setCrossfade(seconds) {
      invalidateTransition()
      engine?.setCrossfade(seconds)
      set({ crossfadeSec: seconds })
    },

    setSleepMinutes(minutes) {
      set({ sleep: startMinutes(minutes) })
    },

    setSleepEndOfTrack() {
      invalidateTransition()
      set({ sleep: startEndOfTrack() })
    },

    cancelSleep() {
      set({ sleep: SLEEP_OFF })
    },

    /**
     * Restores the previous listening session.
     *
     * Loaded paused and seeked to the saved position: resuming playback
     * unprompted on launch is startling, and the spec asks for the session to be
     * restored, not resumed.
     */
    async restoreSession() {
      if (get().sessionRestored || restoringSession) return
      restoringSession = true

      try {
        const settings = await window.resonance.settings.getAll()
        get().init()
        engine?.setVolume(settings.volume ?? 1)
        engine?.setMuted(settings.muted ?? false)
        engine?.setCrossfade(settings.crossfadeSec ?? 0)
        set({
          volume: settings.volume ?? 1,
          muted: settings.muted ?? false,
          crossfadeSec: settings.crossfadeSec ?? 0
        })

        const session = settings.session
        if (!session || session.queue.length === 0) {
          set({ sessionRestored: true })
          return
        }

        // Tracks may have been removed from the library since the session was
        // saved, so the queue is rebuilt from what still exists.
        const all = await window.resonance.library.getTracks()
        const byId = new Map(all.map((t) => [t.id, t]))
        const tracks = session.queue.map((id) => byId.get(id)).filter((t): t is Track => !!t)
        if (tracks.length === 0) {
          set({ sessionRestored: true })
          return
        }

        const index = Math.min(Math.max(0, session.index), tracks.length - 1)
        const known = remember(tracks)
        let queue = qSetQueue(tracks.map((t) => t.id), index, get().queue)
        queue = { ...queue, repeat: session.repeat }
        if (session.shuffle) queue = qSetShuffle(queue, true)

        set({ known, queue, current: byId.get(tracks[index]!.id) ?? null })

        const id = currentTrackId(queue)
        if (id != null && engine) {
          await engine.load(id, false, session.positionSec)
          set({ position: session.positionSec })
          preloadNext()
        }
        set({ sessionRestored: true })
      } finally {
        restoringSession = false
      }
    },

    persistSession() {
      const s = get()
      void window.resonance.settings.set('session', {
        queue: s.queue.items,
        index: s.queue.index,
        positionSec: s.position,
        shuffle: s.queue.shuffle,
        repeat: s.queue.repeat
      })
      void window.resonance.settings.set('volume', s.volume)
      void window.resonance.settings.set('muted', s.muted)
    },

    async next(auto = false) {
      if (auto && transitioning) { endedWhileTransitioning = true; return }
      const result = auto ? nextTransition() : qNext(get().queue, false)
      invalidateTransition()
      set({ queue: result.state, current: syncCurrent(result.state) })

      if (!result.playing) {
        engine?.pause()
        engine?.seek(0)
        return
      }
      await activate(result.state, result.restart)
      get().persistSession()
    },

    async previous() {
      invalidateTransition()
      const result = qPrevious(get().queue, get().position * 1000)
      set({ queue: result.state, current: syncCurrent(result.state) })
      await activate(result.state, result.restart)
    },

    seek(sec) {
      invalidateTransition()
      engine?.seek(sec)
      set({ position: sec })
      preloadNext()
    },

    seekFraction(f) {
      invalidateTransition()
      engine?.seekFraction(f)
      preloadNext()
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
      invalidateTransition()
      const queue = qSetShuffle(get().queue, !get().queue.shuffle)
      set({ queue })
      preloadNext()
    },

    cycleRepeat() {
      invalidateTransition()
      const queue = qCycleRepeat(get().queue)
      set({ queue })
      preloadNext()
    },

    setRepeat(mode) {
      invalidateTransition()
      set({ queue: { ...get().queue, repeat: mode } })
      preloadNext()
    },

    playNext(tracks) {
      if (tracks.length === 0) return
      invalidateTransition()
      const known = remember(tracks)
      const queue = qPlayNext(get().queue, tracks.map((t) => t.id))
      set({ known, queue })
      preloadNext()
    },

    addToQueue(tracks) {
      if (tracks.length === 0) return
      invalidateTransition()
      const known = remember(tracks)
      const queue = qAdd(get().queue, tracks.map((t) => t.id))
      set({ known, queue })
      preloadNext()
    },

    removeFromQueue(index) {
      invalidateTransition()
      const wasPlaying = get().playing
      const wasCurrent = index === get().queue.index
      const queue = qRemoveAt(get().queue, index)
      set({ queue, current: syncCurrent(queue) })
      if (queue.items.length === 0) {
        engine?.stop()
        set({ playing: false, position: 0, duration: 0, buffered: [] })
      } else if (wasCurrent) void activate(queue, false, wasPlaying)
      else preloadNext()
      get().persistSession()
    },

    moveInQueue(from, to) {
      invalidateTransition()
      const queue = qMove(get().queue, from, to)
      set({ queue })
      preloadNext()
    },

    async jumpTo(index) {
      invalidateTransition()
      const queue = qJumpTo(get().queue, index)
      set({ queue, current: syncCurrent(queue) })
      await activate(queue, false)
    },

    refreshKnown(tracks) {
      const known = remember(tracks)
      const id = currentTrackId(get().queue)
      set({ known, current: id == null ? null : known.get(id) ?? null })
    },

    clearError() {
      set({ error: null })
    }
  }
})
