/**
 * Selection arithmetic, kept pure so the fiddly parts are testable without a
 * DOM: range extension across a re-sorted list, toggling, and the anchor that
 * shift-click extends from.
 *
 * Selection is keyed by **track id, never row index**. The library table is
 * virtualized, so only ~23 of N rows are mounted at any time and indices shift
 * whenever the list is sorted or filtered. An index-based selection would
 * silently address different tracks after a sort — the kind of bug that
 * corrupts a playlist rather than merely looking wrong.
 */

export interface SelectionState {
  /** Selected track ids. A Set because membership is checked per rendered row. */
  ids: ReadonlySet<number>
  /** Track id a shift-range extends from, or null. */
  anchorId: number | null
}

export const EMPTY_SELECTION: SelectionState = { ids: new Set(), anchorId: null }

export type ClickModifier = 'none' | 'toggle' | 'range'

/** Reads the modifier from a mouse event. Ctrl on Windows/Linux, Cmd on macOS. */
export function modifierFor(e: {
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
}): ClickModifier {
  if (e.shiftKey) return 'range'
  if (e.ctrlKey || e.metaKey) return 'toggle'
  return 'none'
}

/**
 * Applies a click.
 *
 * `visible` is the list as currently displayed — sorted, filtered, whatever the
 * user is actually looking at — because a shift-range must span what they see,
 * not the underlying library order.
 */
export function applyClick(
  state: SelectionState,
  trackId: number,
  modifier: ClickModifier,
  visible: readonly number[]
): SelectionState {
  switch (modifier) {
    case 'toggle': {
      const ids = new Set(state.ids)
      if (ids.has(trackId)) ids.delete(trackId)
      else ids.add(trackId)
      // The anchor follows the last track touched, so a subsequent shift-click
      // extends from where the user just clicked.
      return { ids, anchorId: trackId }
    }

    case 'range': {
      const anchor = state.anchorId
      // With no anchor yet, shift-click behaves like a plain click rather than
      // selecting nothing.
      if (anchor === null) return { ids: new Set([trackId]), anchorId: trackId }

      const from = visible.indexOf(anchor)
      const to = visible.indexOf(trackId)
      // The anchor can leave the visible list entirely — after a search, say.
      if (from === -1 || to === -1) return { ids: new Set([trackId]), anchorId: trackId }

      const [lo, hi] = from <= to ? [from, to] : [to, from]
      const ids = new Set(visible.slice(lo, hi + 1))
      // The anchor deliberately does NOT move, so dragging a shift-range back
      // and forth grows and shrinks from the same origin.
      return { ids, anchorId: anchor }
    }

    default:
      return { ids: new Set([trackId]), anchorId: trackId }
  }
}

export function selectAll(visible: readonly number[]): SelectionState {
  if (visible.length === 0) return EMPTY_SELECTION
  return { ids: new Set(visible), anchorId: visible[0]! }
}

/**
 * What a right-click should select.
 *
 * Right-clicking inside an existing selection keeps it, so "add these 12 to a
 * playlist" works. Right-clicking outside it selects just that row first —
 * otherwise the menu would silently act on tracks elsewhere in the list.
 */
export function selectionForContextMenu(
  state: SelectionState,
  trackId: number
): SelectionState {
  if (state.ids.has(trackId)) return state
  return { ids: new Set([trackId]), anchorId: trackId }
}

/** Drops ids that are no longer present, e.g. after a rescan removed tracks. */
export function pruneSelection(
  state: SelectionState,
  existing: readonly number[]
): SelectionState {
  const present = new Set(existing)
  const ids = new Set([...state.ids].filter((id) => present.has(id)))
  const anchorId =
    state.anchorId !== null && present.has(state.anchorId) ? state.anchorId : null

  // Returning the same object when nothing changed lets React skip a re-render.
  // The anchor has to be part of that check: it can go stale while the selected
  // ids are untouched, and an early return on ids alone left it dangling.
  if (ids.size === state.ids.size && anchorId === state.anchorId) return state

  return { ids, anchorId }
}

/** Selected ids in the order they appear on screen, for predictable bulk actions. */
export function orderedSelection(
  state: SelectionState,
  visible: readonly number[]
): number[] {
  return visible.filter((id) => state.ids.has(id))
}
