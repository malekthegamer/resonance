import { describe, expect, it } from 'vitest'
import {
  applyClick,
  EMPTY_SELECTION,
  modifierFor,
  orderedSelection,
  pruneSelection,
  selectAll,
  selectionForContextMenu,
  type SelectionState
} from '@renderer/core/selection'

const VISIBLE = [10, 20, 30, 40, 50, 60]

function sel(ids: number[], anchorId: number | null = null): SelectionState {
  return { ids: new Set(ids), anchorId }
}

const ids = (s: SelectionState): number[] => [...s.ids].sort((a, b) => a - b)

describe('modifierFor', () => {
  it('maps the platform modifiers', () => {
    expect(modifierFor({ ctrlKey: false, metaKey: false, shiftKey: false })).toBe('none')
    expect(modifierFor({ ctrlKey: true, metaKey: false, shiftKey: false })).toBe('toggle')
    expect(modifierFor({ ctrlKey: false, metaKey: true, shiftKey: false })).toBe('toggle')
    expect(modifierFor({ ctrlKey: false, metaKey: false, shiftKey: true })).toBe('range')
  })

  it('prefers range when shift is combined with ctrl', () => {
    expect(modifierFor({ ctrlKey: true, metaKey: false, shiftKey: true })).toBe('range')
  })
})

describe('plain click', () => {
  it('replaces the selection and sets the anchor', () => {
    const s = applyClick(sel([10, 20, 30]), 50, 'none', VISIBLE)
    expect(ids(s)).toEqual([50])
    expect(s.anchorId).toBe(50)
  })

  it('clicking an already-selected track narrows to just it', () => {
    const s = applyClick(sel([10, 20, 30]), 20, 'none', VISIBLE)
    expect(ids(s)).toEqual([20])
  })
})

describe('ctrl-click toggle', () => {
  it('adds without losing the rest', () => {
    const s = applyClick(sel([10, 20]), 50, 'toggle', VISIBLE)
    expect(ids(s)).toEqual([10, 20, 50])
  })

  it('removes an already-selected track', () => {
    const s = applyClick(sel([10, 20, 50]), 20, 'toggle', VISIBLE)
    expect(ids(s)).toEqual([10, 50])
  })

  it('moves the anchor so a following shift-click extends from here', () => {
    const s = applyClick(sel([10]), 30, 'toggle', VISIBLE)
    expect(s.anchorId).toBe(30)
  })

  it('can empty the selection completely', () => {
    expect(ids(applyClick(sel([10], 10), 10, 'toggle', VISIBLE))).toEqual([])
  })
})

describe('shift-click range', () => {
  it('selects the span between anchor and target', () => {
    const s = applyClick(sel([20], 20), 50, 'range', VISIBLE)
    expect(ids(s)).toEqual([20, 30, 40, 50])
  })

  it('works backwards', () => {
    const s = applyClick(sel([50], 50), 20, 'range', VISIBLE)
    expect(ids(s)).toEqual([20, 30, 40, 50])
  })

  // Keeping the anchor fixed is what lets a user grow and shrink a range by
  // shift-clicking around without it creeping.
  it('leaves the anchor where it was', () => {
    const first = applyClick(sel([20], 20), 50, 'range', VISIBLE)
    expect(first.anchorId).toBe(20)
    const shrunk = applyClick(first, 30, 'range', VISIBLE)
    expect(ids(shrunk)).toEqual([20, 30])
    expect(shrunk.anchorId).toBe(20)
  })

  it('falls back to a plain click when there is no anchor', () => {
    const s = applyClick(EMPTY_SELECTION, 40, 'range', VISIBLE)
    expect(ids(s)).toEqual([40])
    expect(s.anchorId).toBe(40)
  })

  // The anchor can drop out of view — after typing a search, for instance.
  it('falls back when the anchor is no longer visible', () => {
    const s = applyClick(sel([99], 99), 30, 'range', VISIBLE)
    expect(ids(s)).toEqual([30])
  })

  it('selects a single track when anchor and target are the same', () => {
    expect(ids(applyClick(sel([30], 30), 30, 'range', VISIBLE))).toEqual([30])
  })

  /*
   * The reason selection is keyed by id rather than row index. After a re-sort
   * the same ids must still be selected, and a new range must span the NEW
   * visual order — not the order the list happened to have earlier.
   */
  it('follows the tracks when the list is re-sorted', () => {
    const resorted = [60, 50, 40, 30, 20, 10]
    const s = applyClick(sel([60], 60), 40, 'range', resorted)
    expect(ids(s)).toEqual([40, 50, 60])
  })
})

describe('selectAll', () => {
  it('selects everything currently visible, not the whole library', () => {
    const filtered = [20, 40]
    expect(ids(selectAll(filtered))).toEqual([20, 40])
  })

  it('handles an empty list', () => {
    expect(selectAll([])).toEqual(EMPTY_SELECTION)
  })
})

describe('right-click behaviour', () => {
  it('keeps a multi-selection when right-clicking inside it', () => {
    const existing = sel([10, 20, 30], 10)
    expect(selectionForContextMenu(existing, 20)).toBe(existing)
  })

  // Otherwise the menu would act on tracks the user cannot see.
  it('selects just the row when right-clicking outside the selection', () => {
    const s = selectionForContextMenu(sel([10, 20], 10), 50)
    expect(ids(s)).toEqual([50])
    expect(s.anchorId).toBe(50)
  })
})

describe('pruneSelection', () => {
  it('drops ids that no longer exist', () => {
    const s = pruneSelection(sel([10, 20, 999], 20), VISIBLE)
    expect(ids(s)).toEqual([10, 20])
  })

  it('clears an anchor that no longer exists', () => {
    expect(pruneSelection(sel([10], 999), VISIBLE).anchorId).toBeNull()
  })

  it('returns the same object when nothing changed, so React can skip re-render', () => {
    const s = sel([10, 20], 10)
    expect(pruneSelection(s, VISIBLE)).toBe(s)
  })
})

describe('orderedSelection', () => {
  // Bulk actions should apply in the order the user sees, not Set insertion
  // order, or "add to playlist" would scramble the tracks.
  it('returns selected ids in visible order', () => {
    const s = sel([50, 10, 30])
    expect(orderedSelection(s, VISIBLE)).toEqual([10, 30, 50])
  })

  it('ignores selected ids that are not visible', () => {
    expect(orderedSelection(sel([10, 999]), VISIBLE)).toEqual([10])
  })
})
