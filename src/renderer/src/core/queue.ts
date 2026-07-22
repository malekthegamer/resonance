/**
 * Playback queue state machine.
 *
 * Pure and free of any audio or React dependency, because this is where
 * playback bugs actually live: double-advancing at track end, shuffle that
 * repeats or skips tracks, repeat-one that escapes after a manual skip, and
 * "next" at the end of a list doing the wrong thing under each repeat mode.
 * All of it is testable without a browser.
 */

export type RepeatMode = 'off' | 'all' | 'one'

export interface QueueState {
  /** Track ids in the order they were queued. */
  items: number[]
  /** Index into `items`, or -1 when nothing is loaded. */
  index: number
  shuffle: boolean
  repeat: RepeatMode
  /**
   * Playback order under shuffle: a permutation of item indices. Kept explicit
   * rather than picking a random track each advance, so shuffle plays every
   * track exactly once before repeating — the behaviour users expect, and what
   * random-each-time gets wrong.
   */
  order: number[]
  /** Position within `order`. */
  orderPos: number
}

export const EMPTY_QUEUE: QueueState = {
  items: [],
  index: -1,
  shuffle: false,
  repeat: 'off',
  order: [],
  orderPos: -1
}

/** Fisher-Yates. Injectable RNG so tests are deterministic. */
export function shuffled(length: number, rng: () => number = Math.random): number[] {
  const arr = Array.from({ length }, (_, i) => i)
  for (let i = length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j]!, arr[i]!]
  }
  return arr
}

/**
 * Builds the play order. Under shuffle the currently-playing track is moved to
 * the front so that turning shuffle on does not abruptly change what is playing.
 */
function buildOrder(
  items: number[],
  currentIndex: number,
  shuffle: boolean,
  rng: () => number
): { order: number[]; orderPos: number } {
  if (!shuffle) {
    return { order: items.map((_, i) => i), orderPos: Math.max(0, currentIndex) }
  }

  const order = shuffled(items.length, rng)
  if (currentIndex >= 0) {
    const at = order.indexOf(currentIndex)
    if (at > 0) {
      order.splice(at, 1)
      order.unshift(currentIndex)
    }
  }
  return { order, orderPos: 0 }
}

export function setQueue(
  items: number[],
  startIndex = 0,
  base: QueueState = EMPTY_QUEUE,
  rng: () => number = Math.random
): QueueState {
  if (items.length === 0) return { ...EMPTY_QUEUE, shuffle: base.shuffle, repeat: base.repeat }

  const index = Math.min(Math.max(0, startIndex), items.length - 1)
  const { order, orderPos } = buildOrder(items, index, base.shuffle, rng)
  return { ...base, items: [...items], index, order, orderPos }
}

export function setShuffle(
  state: QueueState,
  shuffle: boolean,
  rng: () => number = Math.random
): QueueState {
  if (shuffle === state.shuffle) return state
  const { order, orderPos } = buildOrder(state.items, state.index, shuffle, rng)
  return { ...state, shuffle, order, orderPos }
}

export function setRepeat(state: QueueState, repeat: RepeatMode): QueueState {
  return { ...state, repeat }
}

export function cycleRepeat(state: QueueState): QueueState {
  const next: RepeatMode = state.repeat === 'off' ? 'all' : state.repeat === 'all' ? 'one' : 'off'
  return setRepeat(state, next)
}

export interface AdvanceResult {
  state: QueueState
  /** False when playback should stop — end of queue with repeat off. */
  playing: boolean
  /** True when the same track should restart from zero (repeat-one). */
  restart: boolean
}

/**
 * Advances to the next track.
 *
 * `auto` distinguishes a track ending on its own from the user pressing next.
 * They must behave differently under repeat-one: a finished track repeats, but
 * pressing next means "I want a different track" and must escape the loop.
 * Conflating them is why repeat-one traps users in some players.
 */
export function next(state: QueueState, auto: boolean, rng: () => number = Math.random): AdvanceResult {
  if (state.items.length === 0) return { state, playing: false, restart: false }

  if (auto && state.repeat === 'one') {
    return { state, playing: true, restart: true }
  }

  const lastPos = state.order.length - 1
  if (state.orderPos < lastPos) {
    const orderPos = state.orderPos + 1
    return {
      state: { ...state, orderPos, index: state.order[orderPos]! },
      playing: true,
      restart: false
    }
  }

  // End of the play order.
  if (state.repeat === 'all' || (!auto && state.repeat === 'one')) {
    // Reshuffle on wrap so a second pass is not identical to the first.
    const { order } = buildOrder(state.items, -1, state.shuffle, rng)
    return {
      state: { ...state, order, orderPos: 0, index: order[0]! },
      playing: true,
      restart: false
    }
  }

  if (!auto) {
    // Manual next at the very end with repeat off: stay put rather than
    // silently stopping, which feels like the button is broken.
    return { state, playing: true, restart: false }
  }

  return { state, playing: false, restart: false }
}

/**
 * Previous track. Restarts the current track when more than `restartAfterMs`
 * into it — the near-universal convention.
 */
export function previous(
  state: QueueState,
  positionMs: number,
  restartAfterMs = 3000
): AdvanceResult {
  if (state.items.length === 0) return { state, playing: false, restart: false }

  if (positionMs > restartAfterMs) {
    return { state, playing: true, restart: true }
  }

  if (state.orderPos > 0) {
    const orderPos = state.orderPos - 1
    return {
      state: { ...state, orderPos, index: state.order[orderPos]! },
      playing: true,
      restart: false
    }
  }

  if (state.repeat === 'all') {
    const orderPos = state.order.length - 1
    return {
      state: { ...state, orderPos, index: state.order[orderPos]! },
      playing: true,
      restart: false
    }
  }

  return { state, playing: true, restart: true }
}

/** Jumps to a specific position in the queue. */
export function jumpTo(state: QueueState, itemIndex: number): QueueState {
  if (itemIndex < 0 || itemIndex >= state.items.length) return state
  const orderPos = state.order.indexOf(itemIndex)
  return { ...state, index: itemIndex, orderPos: orderPos >= 0 ? orderPos : state.orderPos }
}

/** The track that would play next, for preloading. Null when nothing follows. */
export function peekNext(state: QueueState): number | null {
  if (state.items.length === 0) return null
  if (state.repeat === 'one') return state.items[state.index] ?? null

  if (state.orderPos < state.order.length - 1) {
    return state.items[state.order[state.orderPos + 1]!] ?? null
  }
  if (state.repeat === 'all') return state.items[state.order[0]!] ?? null
  return null
}

export function currentTrackId(state: QueueState): number | null {
  return state.index >= 0 ? (state.items[state.index] ?? null) : null
}

/** Inserts tracks directly after the current one ("Play next"). */
export function playNext(state: QueueState, ids: number[]): QueueState {
  if (ids.length === 0) return state
  if (state.items.length === 0) return setQueue(ids, 0, state)

  const items = [...state.items]
  items.splice(state.index + 1, 0, ...ids)
  return reindex(state, items, state.items[state.index]!)
}

export function addToQueue(state: QueueState, ids: number[]): QueueState {
  if (ids.length === 0) return state
  if (state.items.length === 0) return setQueue(ids, 0, state)
  return reindex(state, [...state.items, ...ids], state.items[state.index]!)
}

export function removeAt(state: QueueState, itemIndex: number): QueueState {
  if (itemIndex < 0 || itemIndex >= state.items.length) return state

  const wasCurrent = itemIndex === state.index
  const items = state.items.filter((_, i) => i !== itemIndex)
  if (items.length === 0) return { ...EMPTY_QUEUE, shuffle: state.shuffle, repeat: state.repeat }

  // Removing the current track moves to whatever slid into its place.
  const anchorIndex = wasCurrent
    ? Math.min(itemIndex, items.length - 1)
    : itemIndex < state.index
      ? state.index - 1
      : state.index

  return reindexToIndex(state, items, anchorIndex)
}

/** Reorders the queue (drag to reorder), keeping the same track playing. */
export function move(state: QueueState, from: number, to: number): QueueState {
  if (from === to) return state
  if (from < 0 || from >= state.items.length) return state
  if (to < 0 || to >= state.items.length) return state

  const currentId = state.items[state.index]
  const items = [...state.items]
  const [moved] = items.splice(from, 1)
  items.splice(to, 0, moved!)

  return reindex(state, items, currentId!)
}

/** Rebuilds order after the item list changed, keeping `currentId` playing. */
function reindex(state: QueueState, items: number[], currentId: number): QueueState {
  const index = items.indexOf(currentId)
  return reindexToIndex(state, items, index >= 0 ? index : 0)
}

function reindexToIndex(state: QueueState, items: number[], index: number): QueueState {
  if (!state.shuffle) {
    return { ...state, items, index, order: items.map((_, i) => i), orderPos: index }
  }

  // Preserve the existing shuffle order where possible: dropping or adding one
  // track should not reshuffle everything the user has yet to hear.
  const kept = state.order.filter((i) => i < items.length)
  const missing = items.map((_, i) => i).filter((i) => !kept.includes(i))
  const order = [...kept, ...missing]
  const orderPos = Math.max(0, order.indexOf(index))
  return { ...state, items, index, order, orderPos }
}
