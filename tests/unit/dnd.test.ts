import { describe, expect, it } from 'vitest'
import {
  dragLabel,
  dragPayloadFor,
  readDragData,
  readDropData,
  resolveDrop,
  type DragData,
  type DropData
} from '@renderer/core/dnd'

const libraryDrag = (originId: number, trackIds: number[]): DragData => ({
  type: 'library-tracks',
  originId,
  trackIds
})
const queueDrag = (index: number): DragData => ({ type: 'queue-item', index })
const playlistDrop = (playlistId: number): DropData => ({ type: 'playlist', playlistId })

describe('readDragData', () => {
  it('reads a library drag', () => {
    expect(readDragData({ type: 'library-tracks', originId: 7, trackIds: [7, 9] })).toEqual(
      libraryDrag(7, [7, 9])
    )
  })

  it('reads a queue drag, including position zero', () => {
    expect(readDragData({ type: 'queue-item', index: 0 })).toEqual(queueDrag(0))
  })

  /*
   * dnd-kit hands back `data.current` as an open record, so these are the shapes
   * that would otherwise reach `addTracks` as undefined and corrupt a playlist.
   */
  it.each([
    ['nothing at all', undefined],
    ['null', null],
    ['a bare string', 'library-tracks'],
    ['an unknown type', { type: 'something-else', trackIds: [1] }],
    ['a library drag with no origin', { type: 'library-tracks', trackIds: [1] }],
    ['a library drag with non-numeric ids', { type: 'library-tracks', originId: 1, trackIds: [1, '2'] }],
    ['a library drag with no ids', { type: 'library-tracks', originId: 1 }],
    ['a queue drag with no index', { type: 'queue-item' }]
  ])('rejects %s', (_label, input) => {
    expect(readDragData(input)).toBeNull()
  })

  // dnd-kit's sortable injects its own bookkeeping alongside ours.
  it('ignores extra fields dnd-kit adds', () => {
    expect(readDragData({ type: 'queue-item', index: 3, sortable: { index: 3 } })).toEqual(
      queueDrag(3)
    )
  })
})

describe('readDropData', () => {
  it('reads each target type', () => {
    expect(readDropData({ type: 'playlist', playlistId: 4 })).toEqual(playlistDrop(4))
    expect(readDropData({ type: 'queue' })).toEqual({ type: 'queue' })
    expect(readDropData({ type: 'queue-item', index: 2 })).toEqual({ type: 'queue-item', index: 2 })
  })

  it('rejects a playlist target with no id', () => {
    expect(readDropData({ type: 'playlist' })).toBeNull()
  })
})

describe('dragPayloadFor', () => {
  const selected = new Set([10, 30, 50])
  const inOrder = [10, 30, 50]

  it('drags the whole selection when the grabbed row is part of it', () => {
    expect(dragPayloadFor(30, selected, inOrder)).toEqual([10, 30, 50])
  })

  // Otherwise a stray drag would silently move tracks the user cannot see.
  it('drags only the grabbed row when it is outside the selection', () => {
    expect(dragPayloadFor(99, selected, inOrder)).toEqual([99])
  })

  it('drags just the row when nothing is selected', () => {
    expect(dragPayloadFor(7, new Set(), [])).toEqual([7])
  })
})

describe('resolveDrop', () => {
  it('does nothing without a drop target', () => {
    expect(resolveDrop(libraryDrag(1, [1]), null)).toBeNull()
    expect(resolveDrop(null, playlistDrop(2))).toBeNull()
  })

  it('adds a library drag to the playlist it lands on', () => {
    expect(resolveDrop(libraryDrag(1, [1, 2, 3]), playlistDrop(4))).toEqual({
      kind: 'add-to-playlist',
      playlistId: 4,
      trackIds: [1, 2, 3]
    })
  })

  it('appends to the queue whether it lands on the panel or on a row', () => {
    const expected = { kind: 'add-to-queue', trackIds: [1, 2] }
    expect(resolveDrop(libraryDrag(1, [1, 2]), { type: 'queue' })).toEqual(expected)
    expect(resolveDrop(libraryDrag(1, [1, 2]), { type: 'queue-item', index: 3 })).toEqual(expected)
  })

  it('reorders the queue', () => {
    expect(resolveDrop(queueDrag(0), { type: 'queue-item', index: 3 })).toEqual({
      kind: 'reorder-queue',
      from: 0,
      to: 3
    })
  })

  it('ignores a queue row dropped back on itself', () => {
    expect(resolveDrop(queueDrag(2), { type: 'queue-item', index: 2 })).toBeNull()
  })

  /*
   * Queue rows are restricted to the vertical axis and the other targets are
   * disabled while one is dragging, so this cannot happen through the pointer —
   * but "cannot happen" is exactly what stops being true after a refactor.
   */
  it('refuses to move a queue row onto a playlist', () => {
    expect(resolveDrop(queueDrag(1), playlistDrop(4))).toBeNull()
    expect(resolveDrop(queueDrag(1), { type: 'queue' })).toBeNull()
  })

  it('ignores an empty payload', () => {
    expect(resolveDrop(libraryDrag(1, []), playlistDrop(4))).toBeNull()
  })
})

describe('dragLabel', () => {
  const titles = new Map([
    [1, 'Stay Alive'],
    [2, '']
  ])
  const titleOf = (id: number): string | undefined => titles.get(id)

  it('names the track when there is only one', () => {
    expect(dragLabel([1], titleOf)).toBe('Stay Alive')
  })

  // The library is largely untagged, so a blank title is the common case.
  it('falls back to a count when the single track has no usable title', () => {
    expect(dragLabel([2], titleOf)).toBe('1 track')
    expect(dragLabel([999], titleOf)).toBe('1 track')
  })

  it('counts a batch', () => {
    expect(dragLabel([1, 2, 3], titleOf)).toBe('3 tracks')
  })
})
