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
let searchTimer: ReturnType<typeof setTimeout> | null = null
/** Long enough to skip intermediate keystrokes, short enough to feel instant. */
const SEARCH_DEBOUNCE_MS = 120

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

  /**
   * Switches library section.
   *
   * Clears the search as well as the drill-down. Without that, clicking
   * "Albums" while a search was active changed `view` but the search results
   * kept rendering, so the sidebar looked completely unresponsive — the click
   * registered and nothing happened. Media players clear the search when you
   * navigate, and so does this.
   */
  setView(view) {
    searchToken++ // abandon any in-flight search so a late reply cannot restore it
    set({ view, focus: null, query: '', searchResults: null })
  },

  setFocus(focus) {
    set({ focus })
  },

  async setQuery(query) {
    set({ query })
    if (searchTimer) clearTimeout(searchTimer)

    if (!query.trim()) {
      searchToken++
      set({ searchResults: null })
      return
    }

    // Debounced: without it every keystroke costs an IPC round trip and a full
    // re-render of the results list.
    //
    // Searches are also async and can land out of order, so only the newest
    // result is allowed to win — otherwise a slow early query overwrites a fast
    // later one and the list shows results for a prefix the user already edited.
    const token = ++searchToken
    await new Promise<void>((resolve) => {
      searchTimer = setTimeout(resolve, SEARCH_DEBOUNCE_MS)
    })
    if (token !== searchToken) return

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
