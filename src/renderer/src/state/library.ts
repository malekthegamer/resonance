import { create } from 'zustand'
import { EMPTY_SCAN_PROGRESS, type ScanProgress, type Track } from '@shared/types'
import type { SortDir, SortKey } from '../core/sort'

export type ViewId = 'songs' | 'albums' | 'artists' | 'genres' | 'recent'

interface LibraryState {
  tracks: Track[]
  loading: boolean
  view: ViewId
  /** Set when drilling into one album/artist/genre from a grid. */
  focus: { kind: 'album' | 'artist' | 'genre'; key: string; label: string } | null
  query: string
  searchResults: Track[] | null
  sortKey: SortKey
  sortDir: SortDir
  scan: ScanProgress

  load(): Promise<void>
  setView(view: ViewId): void
  setFocus(focus: LibraryState['focus']): void
  setQuery(query: string): Promise<void>
  toggleSort(key: SortKey): void
  setScan(progress: ScanProgress): void
  scanFolders(): Promise<void>
  scanPaths(paths: string[]): Promise<void>
}

let searchToken = 0

export const useLibrary = create<LibraryState>((set, get) => ({
  tracks: [],
  loading: true,
  view: 'songs',
  focus: null,
  query: '',
  searchResults: null,
  sortKey: 'artist',
  sortDir: 'asc',
  scan: EMPTY_SCAN_PROGRESS,

  async load() {
    set({ loading: true })
    const tracks = await window.resonance.library.getTracks()
    set({ tracks, loading: false })
  },

  setView(view) {
    set({ view, focus: null })
  },

  setFocus(focus) {
    set({ focus })
  },

  async setQuery(query) {
    set({ query })
    if (!query.trim()) {
      set({ searchResults: null })
      return
    }
    // Searches are async and can land out of order; only the newest result wins,
    // otherwise a slow early query overwrites a fast later one.
    const token = ++searchToken
    const results = await window.resonance.library.search(query)
    if (token === searchToken) set({ searchResults: results })
  },

  toggleSort(key) {
    const { sortKey, sortDir } = get()
    if (sortKey === key) set({ sortDir: sortDir === 'asc' ? 'desc' : 'asc' })
    else set({ sortKey: key, sortDir: 'asc' })
  },

  setScan(progress) {
    set({ scan: progress })
  },

  async scanFolders() {
    const result = await window.resonance.library.pickAndScan()
    if (result) await get().load()
  },

  async scanPaths(paths) {
    if (paths.length === 0) return
    await window.resonance.library.scanPaths(paths)
    await get().load()
  }
}))
