import { clamp } from '../core/format'

/**
 * The Web Audio graph. One instance, created once, for the life of the window.
 *
 *   deckA <audio> -> MediaElementSource -> gainA ┐
 *                                                ├-> EQ (10 biquads) -> analyser -> master -> out
 *   deckB <audio> -> MediaElementSource -> gainB ┘
 *
 * Three constraints shape this and each has bitten real players:
 *
 * 1. `createMediaElementSource` may be called only ONCE per element, ever. A
 *    second call kills audio silently with no error. The decks are therefore
 *    built at construction and reused by swapping `src` — never recreated.
 *
 * 2. Media served from `resonance-media://` is cross-origin relative to the
 *    page. A MediaElementAudioSourceNode fed by a cross-origin resource that is
 *    not CORS-approved outputs SILENCE while the element still reports playing
 *    and currentTime still advances. `crossOrigin` must be set BEFORE `src` is
 *    ever assigned — setting it afterwards does not un-taint the element.
 *
 * 3. Two decks (rather than one) give crossfade and gapless preload from a
 *    single topology, and let the next track buffer while the current plays.
 */

export const EQ_FREQUENCIES = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] as const
export const EQ_BAND_COUNT = EQ_FREQUENCIES.length
export const EQ_MAX_GAIN_DB = 12

export type DeckId = 'a' | 'b'

interface Deck {
  id: DeckId
  el: HTMLAudioElement
  source: MediaElementAudioSourceNode
  gain: GainNode
  /** Track id currently loaded, or null. */
  trackId: number | null
}

export interface EngineEvents {
  onTimeUpdate(positionSec: number, durationSec: number): void
  /** Fired once per natural track end, never twice for the same playthrough. */
  onEnded(): void
  onPlayingChanged(playing: boolean): void
  onError(message: string): void
  onBuffered(ranges: Array<[number, number]>): void
}

function mediaUrl(trackId: number): string {
  return `resonance-media://track/${trackId}`
}

export class AudioEngine {
  readonly ctx: AudioContext
  readonly analyser: AnalyserNode
  private readonly master: GainNode
  private readonly filters: BiquadFilterNode[]
  private readonly decks: Record<DeckId, Deck>
  private active: DeckId = 'a'
  private events: EngineEvents
  private volume = 1
  private muted = false

  /**
   * Guards against double-advance. Every load gets a token; an `ended` event
   * carrying a stale token is ignored. Without this, a track that fires `ended`
   * twice — or fires it after the user already skipped — advances the queue
   * twice and appears to skip a track at random.
   */
  private generation = 0

  private crossfadeSec = 0

  constructor(events: EngineEvents) {
    this.events = events
    this.ctx = new AudioContext({ latencyHint: 'playback' })

    this.master = this.ctx.createGain()
    this.master.gain.value = 1

    this.analyser = this.ctx.createAnalyser()
    this.analyser.fftSize = 2048
    this.analyser.smoothingTimeConstant = 0.8

    // Ten peaking filters in series; flat (0 dB) until the EQ is used.
    this.filters = EQ_FREQUENCIES.map((freq) => {
      const f = this.ctx.createBiquadFilter()
      f.type = 'peaking'
      f.frequency.value = freq
      f.Q.value = 1.1
      f.gain.value = 0
      return f
    })

    // EQ chain -> analyser -> master -> destination. The analyser sits after the
    // EQ so the visualizer shows what is actually heard, and after the mix so a
    // crossfade is visible in it.
    let node: AudioNode = this.filters[0]!
    for (let i = 1; i < this.filters.length; i++) {
      node.connect(this.filters[i]!)
      node = this.filters[i]!
    }
    node.connect(this.analyser)
    this.analyser.connect(this.master)
    this.master.connect(this.ctx.destination)

    this.decks = {
      a: this.createDeck('a'),
      b: this.createDeck('b')
    }
  }

  private createDeck(id: DeckId): Deck {
    const el = new Audio()
    // MUST precede any src assignment — see constraint 2 above.
    el.crossOrigin = 'anonymous'
    el.preload = 'auto'
    el.volume = 1

    const source = this.ctx.createMediaElementSource(el)
    const gain = this.ctx.createGain()
    gain.gain.value = id === 'a' ? 1 : 0
    source.connect(gain)
    gain.connect(this.filters[0]!)

    const deck: Deck = { id, el, source, gain, trackId: null }

    el.addEventListener('timeupdate', () => {
      if (this.active !== id) return
      this.events.onTimeUpdate(el.currentTime, Number.isFinite(el.duration) ? el.duration : 0)
    })

    el.addEventListener('progress', () => {
      if (this.active !== id) return
      const ranges: Array<[number, number]> = []
      for (let i = 0; i < el.buffered.length; i++) {
        ranges.push([el.buffered.start(i), el.buffered.end(i)])
      }
      this.events.onBuffered(ranges)
    })

    el.addEventListener('ended', () => {
      if (this.active !== id) return
      const gen = this.generation
      // Re-check on the next tick: a stale `ended` from a superseded load would
      // otherwise advance the queue a second time.
      queueMicrotask(() => {
        if (gen !== this.generation) return
        this.events.onEnded()
      })
    })

    el.addEventListener('play', () => {
      if (this.active === id) this.events.onPlayingChanged(true)
    })
    el.addEventListener('pause', () => {
      if (this.active === id) this.events.onPlayingChanged(false)
    })
    el.addEventListener('error', () => {
      if (this.active !== id) return
      const code = el.error?.code
      this.events.onError(
        code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED
          ? 'This file format could not be played'
          : 'The file could not be read — it may have been moved or deleted'
      )
    })

    return deck
  }

  private get activeDeck(): Deck {
    return this.decks[this.active]
  }

  private get idleDeck(): Deck {
    return this.decks[this.active === 'a' ? 'b' : 'a']
  }

  /** Browsers start an AudioContext suspended until a user gesture. */
  async resume(): Promise<void> {
    if (this.ctx.state === 'suspended') await this.ctx.resume()
  }

  /** Loads and plays a track on the active deck. */
  async load(trackId: number, autoplay = true, startAtSec = 0): Promise<void> {
    this.generation++
    await this.resume()

    const deck = this.activeDeck
    const idle = this.idleDeck

    // If the requested track is already buffered on the idle deck (preloaded),
    // swap decks instead of reloading it from scratch.
    if (idle.trackId === trackId && idle.el.readyState >= HTMLMediaElement.HAVE_METADATA) {
      deck.el.pause()
      this.active = idle.id
      this.setDeckGain(idle, 1, 0)
      this.setDeckGain(deck, 0, 0)
      if (startAtSec > 0) idle.el.currentTime = startAtSec
      if (autoplay) await this.safePlay(idle.el)
      return
    }

    deck.trackId = trackId
    deck.el.src = mediaUrl(trackId)
    this.setDeckGain(deck, 1, 0)
    this.setDeckGain(idle, 0, 0)

    if (startAtSec > 0) {
      const seek = (): void => {
        deck.el.currentTime = startAtSec
        deck.el.removeEventListener('loadedmetadata', seek)
      }
      deck.el.addEventListener('loadedmetadata', seek)
    }

    if (autoplay) await this.safePlay(deck.el)
  }

  /**
   * Buffers the next track on the idle deck so the transition is gapless.
   * Silent and best-effort: a failed preload must never disturb playback.
   */
  preload(trackId: number | null): void {
    if (trackId == null) return
    const idle = this.idleDeck
    if (idle.trackId === trackId) return
    idle.trackId = trackId
    idle.el.src = mediaUrl(trackId)
    idle.el.load()
  }

  private async safePlay(el: HTMLAudioElement): Promise<void> {
    try {
      await el.play()
    } catch (err) {
      // AbortError is normal when a load supersedes a pending play().
      if (err instanceof DOMException && err.name === 'AbortError') return
      this.events.onError(err instanceof Error ? err.message : 'Playback failed')
    }
  }

  async play(): Promise<void> {
    await this.resume()
    await this.safePlay(this.activeDeck.el)
  }

  pause(): void {
    this.activeDeck.el.pause()
  }

  async toggle(): Promise<void> {
    if (this.activeDeck.el.paused) await this.play()
    else this.pause()
  }

  /** Stop: pause and rewind, distinct from pause (spec requires both). */
  stop(): void {
    this.generation++
    for (const deck of Object.values(this.decks)) {
      deck.el.pause()
      deck.el.currentTime = 0
    }
    this.events.onPlayingChanged(false)
  }

  seek(sec: number): void {
    const el = this.activeDeck.el
    const duration = Number.isFinite(el.duration) ? el.duration : 0
    if (duration <= 0) return
    el.currentTime = clamp(sec, 0, duration)
  }

  seekFraction(fraction: number): void {
    const el = this.activeDeck.el
    const duration = Number.isFinite(el.duration) ? el.duration : 0
    if (duration > 0) this.seek(clamp(fraction, 0, 1) * duration)
  }

  setVolume(value: number): void {
    this.volume = clamp(value, 0, 1)
    this.applyOutputGain()
  }

  getVolume(): number {
    return this.volume
  }

  setMuted(muted: boolean): void {
    this.muted = muted
    this.applyOutputGain()
  }

  isMuted(): boolean {
    return this.muted
  }

  /**
   * Applies a value to an AudioParam, smoothly while audio is running and
   * instantly when it is not.
   *
   * `setTargetAtTime` only advances with the context clock. On a suspended
   * context — which is the normal state when nothing is playing — the parameter
   * never moves, so an EQ or volume change made while idle was silently
   * discarded and only took effect after playback started.
   */
  private applyParam(param: AudioParam, value: number, timeConstant: number): void {
    if (this.ctx.state !== 'running') {
      param.cancelScheduledValues(0)
      param.value = value
      return
    }
    const now = this.ctx.currentTime
    param.cancelScheduledValues(now)
    // Ramp rather than jump: an abrupt gain change is audible as a click.
    param.setTargetAtTime(value, now, timeConstant)
  }

  private applyOutputGain(): void {
    this.applyParam(this.master.gain, this.muted ? 0 : this.volume, 0.015)
  }

  private setDeckGain(deck: Deck, value: number, rampSec: number): void {
    const now = this.ctx.currentTime
    const g = deck.gain.gain
    g.cancelScheduledValues(now)
    if (rampSec <= 0) {
      g.setValueAtTime(value, now)
    } else {
      g.setValueAtTime(g.value, now)
      g.linearRampToValueAtTime(value, now + rampSec)
    }
  }

  setCrossfade(seconds: number): void {
    this.crossfadeSec = clamp(seconds, 0, 12)
  }

  getCrossfade(): number {
    return this.crossfadeSec
  }

  /**
   * Crossfades into `trackId` on the idle deck. Falls back to a plain load when
   * crossfade is disabled or the next track is not ready.
   */
  async crossfadeTo(trackId: number): Promise<void> {
    if (this.crossfadeSec <= 0) {
      await this.load(trackId, true)
      return
    }

    this.generation++
    await this.resume()

    const outgoing = this.activeDeck
    const incoming = this.idleDeck

    if (incoming.trackId !== trackId) {
      incoming.trackId = trackId
      incoming.el.src = mediaUrl(trackId)
    }
    incoming.el.currentTime = 0

    this.active = incoming.id
    this.setDeckGain(incoming, 1, this.crossfadeSec)
    this.setDeckGain(outgoing, 0, this.crossfadeSec)
    await this.safePlay(incoming.el)

    // Stop the outgoing deck only after its gain has actually reached zero,
    // otherwise the tail is audibly cut off.
    window.setTimeout(
      () => {
        if (this.active !== outgoing.id) outgoing.el.pause()
      },
      this.crossfadeSec * 1000 + 60
    )
  }

  /** EQ band gain in dB, -12..+12. */
  setBandGain(index: number, db: number): void {
    const filter = this.filters[index]
    if (!filter) return
    const value = clamp(db, -EQ_MAX_GAIN_DB, EQ_MAX_GAIN_DB)
    this.applyParam(filter.gain, value, 0.01)
  }

  setBandGains(gains: number[]): void {
    gains.forEach((db, i) => this.setBandGain(i, db))
  }

  getBandGains(): number[] {
    return this.filters.map((f) => f.gain.value)
  }

  get position(): number {
    return this.activeDeck.el.currentTime
  }

  get duration(): number {
    const d = this.activeDeck.el.duration
    return Number.isFinite(d) ? d : 0
  }

  get playing(): boolean {
    return !this.activeDeck.el.paused
  }

  get currentTrackId(): number | null {
    return this.activeDeck.trackId
  }

  /** Frequency data for the visualizer. Reuses one buffer to avoid GC churn. */
  private freqData: Uint8Array | null = null
  getFrequencyData(): Uint8Array {
    if (!this.freqData || this.freqData.length !== this.analyser.frequencyBinCount) {
      this.freqData = new Uint8Array(this.analyser.frequencyBinCount)
    }
    this.analyser.getByteFrequencyData(this.freqData)
    return this.freqData
  }

  dispose(): void {
    for (const deck of Object.values(this.decks)) {
      deck.el.pause()
      deck.el.removeAttribute('src')
      deck.el.load()
    }
    void this.ctx.close()
  }
}
