import { create } from 'zustand'
import type { Track } from '@shared/types'
import type { PlaylistSummary } from '../../../main/db/playlists'

interface PlaylistState {
  playlists: PlaylistSummary[]
  /** Currently opened playlist, if any. */
  openId: number | null
  openTracks: Track[]
  /** Last import outcome, surfaced so missing tracks are not hidden. */
  lastImport: { name: string; matched: number; missing: number } | null

  refresh(): Promise<void>
  open(id: number | null): Promise<void>
  create(name: string): Promise<number>
  rename(id: number, name: string): Promise<void>
  remove(id: number): Promise<void>
  addTracks(id: number, trackIds: number[]): Promise<void>
  removeAt(position: number): Promise<void>
  reorder(from: number, to: number): Promise<void>
  importFiles(paths?: string[]): Promise<void>
  exportPlaylist(id: number): Promise<string | null>
  clearImportNotice(): void
}

export const usePlaylists = create<PlaylistState>((set, get) => ({
  playlists: [],
  openId: null,
  openTracks: [],
  lastImport: null,

  async refresh() {
    set({ playlists: await window.resonance.playlists.list() })
  },

  async open(id) {
    if (id == null) {
      set({ openId: null, openTracks: [] })
      return
    }
    const tracks = await window.resonance.playlists.tracks(id)
    set({ openId: id, openTracks: tracks })
  },

  async create(name) {
    const id = await window.resonance.playlists.create(name)
    await get().refresh()
    return id
  },

  async rename(id, name) {
    await window.resonance.playlists.rename(id, name)
    await get().refresh()
  },

  async remove(id) {
    await window.resonance.playlists.remove(id)
    if (get().openId === id) set({ openId: null, openTracks: [] })
    await get().refresh()
  },

  async addTracks(id, trackIds) {
    await window.resonance.playlists.addTracks(id, trackIds)
    await get().refresh()
    if (get().openId === id) await get().open(id)
  },

  async removeAt(position) {
    const id = get().openId
    if (id == null) return
    await window.resonance.playlists.removeAt(id, position)
    await get().open(id)
    await get().refresh()
  },

  async reorder(from, to) {
    const id = get().openId
    if (id == null) return

    // Reorder locally first so the drag feels instant, then persist. A round
    // trip before repainting makes drag-to-reorder feel broken.
    const tracks = [...get().openTracks]
    const [moved] = tracks.splice(from, 1)
    if (moved) tracks.splice(to, 0, moved)
    set({ openTracks: tracks })

    await window.resonance.playlists.reorder(id, from, to)
    await get().refresh()
  },

  async importFiles(paths) {
    const results = await window.resonance.playlists.importFiles(paths)
    await get().refresh()
    if (results.length > 0) {
      const total = results.reduce(
        (acc, r) => ({
          name: results.length === 1 ? r.name : `${results.length} playlists`,
          matched: acc.matched + r.matched,
          missing: acc.missing + r.missing
        }),
        { name: '', matched: 0, missing: 0 }
      )
      set({ lastImport: total })
    }
  },

  exportPlaylist(id) {
    return window.resonance.playlists.exportPlaylist(id)
  },

  clearImportNotice() {
    set({ lastImport: null })
  }
}))
