import { describe, expect, it } from 'vitest'
import {
  addToQueue,
  cycleRepeat,
  currentTrackId,
  EMPTY_QUEUE,
  jumpTo,
  move,
  next,
  peekNext,
  playNext,
  previous,
  removeAt,
  setQueue,
  setShuffle,
  shuffled
} from '@renderer/core/queue'

/** Deterministic RNG so shuffle behaviour is reproducible. */
function seededRng(seed = 42): () => number {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
}

const IDS = [10, 20, 30, 40, 50]

describe('setQueue', () => {
  it('starts at the requested index', () => {
    expect(currentTrackId(setQueue(IDS, 2))).toBe(30)
  })

  it('clamps an out-of-range start index instead of breaking', () => {
    expect(currentTrackId(setQueue(IDS, 99))).toBe(50)
    expect(currentTrackId(setQueue(IDS, -5))).toBe(10)
  })

  it('handles an empty list', () => {
    const s = setQueue([], 0)
    expect(s.index).toBe(-1)
    expect(currentTrackId(s)).toBeNull()
  })
})

describe('next — every repeat mode at the end of the queue', () => {
  it('advances through the queue in order', () => {
    let s = setQueue(IDS, 0)
    const seen = [currentTrackId(s)]
    for (let i = 0; i < 4; i++) {
      const r = next(s, true)
      s = r.state
      seen.push(currentTrackId(s))
    }
    expect(seen).toEqual(IDS)
  })

  it('repeat off: stops at the end when the track finished on its own', () => {
    const s = setQueue(IDS, 4)
    const r = next(s, true)
    expect(r.playing).toBe(false)
    expect(currentTrackId(r.state)).toBe(50)
  })

  it('repeat all: wraps to the start', () => {
    const s = { ...setQueue(IDS, 4), repeat: 'all' as const }
    const r = next(s, true)
    expect(r.playing).toBe(true)
    expect(currentTrackId(r.state)).toBe(10)
  })

  // The distinction that makes repeat-one usable rather than a trap.
  it('repeat one: a finished track restarts, but pressing next escapes', () => {
    const s = { ...setQueue(IDS, 2), repeat: 'one' as const }

    const auto = next(s, true)
    expect(auto.restart).toBe(true)
    expect(currentTrackId(auto.state)).toBe(30)

    const manual = next(s, false)
    expect(manual.restart).toBe(false)
    expect(currentTrackId(manual.state)).toBe(40)
  })

  it('manual next at the end with repeat off stays put rather than stopping', () => {
    const s = setQueue(IDS, 4)
    const r = next(s, false)
    expect(r.playing).toBe(true)
    expect(currentTrackId(r.state)).toBe(50)
  })

  it('does nothing on an empty queue', () => {
    const r = next(EMPTY_QUEUE, true)
    expect(r.playing).toBe(false)
  })
})

describe('previous', () => {
  it('restarts the current track when past the threshold', () => {
    const s = setQueue(IDS, 2)
    const r = previous(s, 5000)
    expect(r.restart).toBe(true)
    expect(currentTrackId(r.state)).toBe(30)
  })

  it('steps back when near the start of the track', () => {
    const s = setQueue(IDS, 2)
    const r = previous(s, 500)
    expect(currentTrackId(r.state)).toBe(20)
  })

  it('wraps to the end under repeat all', () => {
    const s = { ...setQueue(IDS, 0), repeat: 'all' as const }
    expect(currentTrackId(previous(s, 0).state)).toBe(50)
  })

  it('restarts rather than wrapping at the first track with repeat off', () => {
    const r = previous(setQueue(IDS, 0), 0)
    expect(r.restart).toBe(true)
    expect(currentTrackId(r.state)).toBe(10)
  })
})

describe('shuffle', () => {
  it('produces a permutation containing every index exactly once', () => {
    const order = shuffled(50, seededRng())
    expect(new Set(order).size).toBe(50)
    expect([...order].sort((a, b) => a - b)).toEqual(Array.from({ length: 50 }, (_, i) => i))
  })

  it('keeps the current track playing when shuffle is switched on', () => {
    const s = setQueue(IDS, 2)
    const shuffledState = setShuffle(s, true, seededRng())
    expect(currentTrackId(shuffledState)).toBe(30)
  })

  // The property that random-per-advance gets wrong.
  it('plays every track exactly once before repeating', () => {
    let s = setShuffle(setQueue(IDS, 0), true, seededRng())
    s = { ...s, repeat: 'all' }

    const seen = [currentTrackId(s)]
    for (let i = 0; i < IDS.length - 1; i++) {
      s = next(s, true, seededRng()).state
      seen.push(currentTrackId(s))
    }
    expect(new Set(seen).size).toBe(IDS.length)
    expect([...seen].sort((a, b) => a! - b!)).toEqual(IDS)
  })

  it('returns to sequential order when shuffle is switched off', () => {
    let s = setShuffle(setQueue(IDS, 0), true, seededRng())
    s = setShuffle(s, false)
    expect(s.order).toEqual([0, 1, 2, 3, 4])
  })
})

describe('peekNext — what gets preloaded', () => {
  it('returns the following track', () => {
    expect(peekNext(setQueue(IDS, 1))).toBe(30)
  })

  it('returns null at the end with repeat off, so nothing is preloaded', () => {
    expect(peekNext(setQueue(IDS, 4))).toBeNull()
  })

  it('wraps under repeat all', () => {
    expect(peekNext({ ...setQueue(IDS, 4), repeat: 'all' })).toBe(10)
  })

  it('returns the same track under repeat one', () => {
    expect(peekNext({ ...setQueue(IDS, 2), repeat: 'one' })).toBe(30)
  })
})

describe('queue editing', () => {
  it('playNext inserts directly after the current track', () => {
    const s = playNext(setQueue(IDS, 1), [99])
    expect(s.items).toEqual([10, 20, 99, 30, 40, 50])
    expect(currentTrackId(s)).toBe(20)
  })

  it('addToQueue appends without changing what is playing', () => {
    const s = addToQueue(setQueue(IDS, 1), [99])
    expect(s.items[s.items.length - 1]).toBe(99)
    expect(currentTrackId(s)).toBe(20)
  })

  it('removing a track before the current one keeps the same track playing', () => {
    const s = removeAt(setQueue(IDS, 3), 0)
    expect(currentTrackId(s)).toBe(40)
  })

  it('removing the current track moves to the one that slid into place', () => {
    const s = removeAt(setQueue(IDS, 2), 2)
    expect(currentTrackId(s)).toBe(40)
  })

  it('removing the last remaining track empties the queue', () => {
    const s = removeAt(setQueue([10], 0), 0)
    expect(s.items).toEqual([])
    expect(currentTrackId(s)).toBeNull()
  })

  it('reordering keeps the same track playing', () => {
    const s = move(setQueue(IDS, 0), 4, 0)
    expect(s.items).toEqual([50, 10, 20, 30, 40])
    expect(currentTrackId(s)).toBe(10)
  })

  it('ignores out-of-range moves', () => {
    const s = setQueue(IDS, 0)
    expect(move(s, -1, 2)).toBe(s)
    expect(move(s, 0, 99)).toBe(s)
  })

  it('jumpTo selects a track and keeps order consistent', () => {
    const s = jumpTo(setQueue(IDS, 0), 3)
    expect(currentTrackId(s)).toBe(40)
    expect(s.order[s.orderPos]).toBe(3)
  })
})

describe('repeat cycling', () => {
  it('goes off -> all -> one -> off', () => {
    let s = setQueue(IDS, 0)
    expect(s.repeat).toBe('off')
    s = cycleRepeat(s)
    expect(s.repeat).toBe('all')
    s = cycleRepeat(s)
    expect(s.repeat).toBe('one')
    s = cycleRepeat(s)
    expect(s.repeat).toBe('off')
  })
})

describe('shuffle x repeat x end-of-list, exhaustively', () => {
  // The plan calls for every combination; a bug here is the difference between
  // playback that feels solid and playback that feels haunted.
  for (const shuffle of [false, true]) {
    for (const repeat of ['off', 'all', 'one'] as const) {
      for (const auto of [true, false]) {
        it(`shuffle=${shuffle} repeat=${repeat} auto=${auto} never corrupts state`, () => {
          let s = setShuffle(setQueue(IDS, 0), shuffle, seededRng())
          s = { ...s, repeat }

          for (let i = 0; i < 25; i++) {
            const r = next(s, auto, seededRng())
            s = r.state

            expect(s.order.length).toBe(s.items.length)
            expect(new Set(s.order).size).toBe(s.items.length)
            expect(s.orderPos).toBeGreaterThanOrEqual(0)
            expect(s.orderPos).toBeLessThan(s.order.length)
            expect(s.index).toBe(s.order[s.orderPos])
            expect(currentTrackId(s)).not.toBeNull()

            if (!r.playing) break
          }
        })
      }
    }
  }
})
