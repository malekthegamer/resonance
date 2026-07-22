import { create } from 'zustand'
import type { Track } from '@shared/types'
import {
  applyClick,
  EMPTY_SELECTION,
  orderedSelection,
  pruneSelection,
  selectAll,
  selectionForContextMenu,
  type ClickModifier,
  type SelectionState
} from '../core/selection'

interface SelectionStore {
  selection: SelectionState

  click(trackId: number, modifier: ClickModifier, visible: readonly number[]): void
  selectAllVisible(visible: readonly number[]): void
  contextMenuAt(trackId: number): void
  clear(): void
  prune(existing: readonly number[]): void

  isSelected(trackId: number): boolean
  count(): number
  /** Selected tracks in the order they appear on screen. */
  selectedTracks(visible: readonly Track[]): Track[]
}

export const useSelection = create<SelectionStore>((set, get) => ({
  selection: EMPTY_SELECTION,

  click(trackId, modifier, visible) {
    set({ selection: applyClick(get().selection, trackId, modifier, visible) })
  },

  selectAllVisible(visible) {
    set({ selection: selectAll(visible) })
  },

  contextMenuAt(trackId) {
    set({ selection: selectionForContextMenu(get().selection, trackId) })
  },

  clear() {
    // Referential equality matters here: clearing an already-empty selection
    // should not re-render every mounted row.
    if (get().selection.ids.size === 0 && get().selection.anchorId === null) return
    set({ selection: EMPTY_SELECTION })
  },

  prune(existing) {
    const next = pruneSelection(get().selection, existing)
    if (next !== get().selection) set({ selection: next })
  },

  isSelected(trackId) {
    return get().selection.ids.has(trackId)
  },

  count() {
    return get().selection.ids.size
  },

  selectedTracks(visible) {
    const order = orderedSelection(
      get().selection,
      visible.map((t) => t.id)
    )
    const byId = new Map(visible.map((t) => [t.id, t]))
    return order.map((id) => byId.get(id)!).filter(Boolean)
  }
}))

/*
 * Test hook.
 *
 * Selection has to be observable independently of the DOM: the track list is
 * virtualized, so a selected row that scrolls out of the window is no longer
 * mounted and cannot report `aria-selected`. Asserting through the DOM alone
 * would make "selection survives a re-sort" untestable — which is precisely the
 * behaviour that keying by id rather than row index exists to provide.
 */
if (typeof window !== 'undefined') {
  ;(window as unknown as Record<string, unknown>)['__resonanceSelection'] = useSelection
}
