/**
 * Drag-and-drop arithmetic, kept pure so the routing decisions are testable
 * without a DOM or a pointer.
 *
 * There is exactly one `DndContext`, at App level. dnd-kit does not support
 * nesting them, and the queue panel used to own its own — so a library row and
 * a queue row are now distinguished by the `type` on their drag data rather
 * than by which provider they happened to be under.
 */

/** A drag that started on one or more library rows. */
export interface LibraryDrag {
  type: 'library-tracks'
  /** The row the pointer actually grabbed. */
  originId: number
  /** Everything the drag carries: the selection, if the origin is part of it. */
  trackIds: readonly number[]
}

/** A drag that started on a queue row. Queue positions, not track ids. */
export interface QueueDrag {
  type: 'queue-item'
  index: number
}

export type DragData = LibraryDrag | QueueDrag

export interface PlaylistDrop {
  type: 'playlist'
  playlistId: number
}

/** The queue panel as a whole, so a drop anywhere in it appends. */
export interface QueueDrop {
  type: 'queue'
}

/** Queue rows are droppable as well as draggable — that is how reordering works. */
export type DropData = PlaylistDrop | QueueDrop | QueueDrag

export type DropAction =
  | { kind: 'reorder-queue'; from: number; to: number }
  | { kind: 'add-to-playlist'; playlistId: number; trackIds: readonly number[] }
  | { kind: 'add-to-queue'; trackIds: readonly number[] }

/*
 * dnd-kit types `data.current` as an open record, so anything can be in there.
 * These readers turn it back into a closed union instead of casting and hoping —
 * a malformed payload becomes `null` and the drop is ignored, rather than
 * reaching `addTracks` with `undefined` in it.
 */

export function readDragData(data: unknown): DragData | null {
  if (!data || typeof data !== 'object') return null
  const d = data as Record<string, unknown>

  if (d['type'] === 'queue-item' && typeof d['index'] === 'number') {
    return { type: 'queue-item', index: d['index'] }
  }
  if (
    d['type'] === 'library-tracks' &&
    typeof d['originId'] === 'number' &&
    Array.isArray(d['trackIds']) &&
    d['trackIds'].every((id) => typeof id === 'number')
  ) {
    return {
      type: 'library-tracks',
      originId: d['originId'],
      trackIds: d['trackIds'] as number[]
    }
  }
  return null
}

export function readDropData(data: unknown): DropData | null {
  if (!data || typeof data !== 'object') return null
  const d = data as Record<string, unknown>

  if (d['type'] === 'queue-item' && typeof d['index'] === 'number') {
    return { type: 'queue-item', index: d['index'] }
  }
  if (d['type'] === 'queue') return { type: 'queue' }
  if (d['type'] === 'playlist' && typeof d['playlistId'] === 'number') {
    return { type: 'playlist', playlistId: d['playlistId'] }
  }
  return null
}

/**
 * What a drag starting on `trackId` should carry.
 *
 * Grabbing a row inside the selection drags the whole selection; grabbing one
 * outside it drags just that row (and App narrows the selection to match, so
 * what moves is always what is highlighted).
 *
 * Membership is checked against the Set and the payload comes from the ordered
 * array: this runs once per mounted row per render, so it has to be O(1).
 */
export function dragPayloadFor(
  trackId: number,
  selectedIds: ReadonlySet<number>,
  selectedInOrder: readonly number[]
): readonly number[] {
  return selectedIds.has(trackId) ? selectedInOrder : [trackId]
}

/**
 * Turns a completed drag into the action it means, or `null` for a no-op.
 *
 * Queue rows only ever reorder. They are pinned to the vertical axis while
 * dragging and every other drop target is disabled for the duration, so a queue
 * row cannot physically reach the sidebar — the restriction here matches what
 * the pointer can actually do.
 */
export function resolveDrop(
  active: DragData | null,
  over: DropData | null
): DropAction | null {
  if (!active || !over) return null

  if (active.type === 'queue-item') {
    if (over.type !== 'queue-item') return null
    if (over.index === active.index) return null
    return { kind: 'reorder-queue', from: active.index, to: over.index }
  }

  if (active.trackIds.length === 0) return null

  if (over.type === 'playlist') {
    return { kind: 'add-to-playlist', playlistId: over.playlistId, trackIds: active.trackIds }
  }
  // Anywhere in the queue panel appends. Positioning within the queue is the
  // queue's own drag; conflating the two would make a drop near a row look like
  // an insert when it is not.
  if (over.type === 'queue' || over.type === 'queue-item') {
    return { kind: 'add-to-queue', trackIds: active.trackIds }
  }
  return null
}

/** Text for the drag overlay. One track reads better as its title than as a count. */
export function dragLabel(
  trackIds: readonly number[],
  titleOf: (id: number) => string | undefined
): string {
  if (trackIds.length === 1) {
    const title = titleOf(trackIds[0]!)
    return title && title.trim() ? title : '1 track'
  }
  return `${trackIds.length} tracks`
}
