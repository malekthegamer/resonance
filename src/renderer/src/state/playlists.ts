import { create } from 'zustand'
import type { Track } from '@shared/types'
import type { PlaylistSummary } from '../../../main/db/playlists'

interface PlaylistState {
  playlists: PlaylistSummary[]
  /** Currently opened playlist, if any. */
  openId: number | null
  openTracks: Track[]
  saving: boolean
  /** Last import outcome, surfaced so missing tracks are not hidden. */
  lastImport: { name: string; matched: number; missing: number } | null

  refresh(): Promise<void>
  open(id: number | null): Promise<void>
  create(name: string): Promise<number>
  rename(id: number, name: string): Promise<void>
  remove(id: number): Promise<void>
  addTracks(id: number, trackIds: number[]): Promise<void>
  removeAt(position: number): Promise<void>
  reorder(id: number, from: number, to: number): Promise<void>
  refreshOpen(): Promise<void>
  importFiles(paths?: string[]): Promise<void>
  exportPlaylist(id: number): Promise<string | null>
  clearImportNotice(): void
}

let openToken = 0
export const usePlaylists = create<PlaylistState>((set, get) => ({
  playlists: [],
  openId: null,
  openTracks: [],
  saving: false,
  lastImport: null,

  async refresh() {
    set({ playlists: await window.resonance.playlists.list() })
  },

  async open(id) {
    const token = ++openToken
    set({ openId: id, openTracks: [] })
    if (id == null) {
      set({ openId: null, openTracks: [] })
      return
    }
    const tracks = await window.resonance.playlists.tracks(id)
    if (token === openToken && get().openId === id) set({ openTracks: tracks })
  },

  async refreshOpen() {
    const id = get().openId
    const token = openToken
    if (id == null || get().saving) return
    const tracks = await window.resonance.playlists.tracks(id)
    if (token === openToken && get().openId === id && !get().saving) set({ openTracks: tracks })
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
    if (get().saving) throw new Error('Please wait for playlist changes to finish saving.')
    await window.resonance.playlists.remove(id)
    if (get().openId === id) { openToken++; set({ openId: null, openTracks: [] }) }
    await get().refresh()
  },

  async addTracks(id, trackIds) {
    if (get().saving) throw new Error('Please wait for playlist changes to finish saving.')
    set({ saving: true })
    openToken++
    try { await window.resonance.playlists.addTracks(id, trackIds) }
    finally { set({ saving: false }); await get().refresh(); await get().refreshOpen() }
  },

  async removeAt(position) {
    if (get().saving) throw new Error('Please wait for playlist changes to finish saving.')
    const id = get().openId
    if (id == null) return
    set({ saving: true })
    openToken++
    try { await window.resonance.playlists.removeAt(id, position) }
    finally { set({ saving: false }); await get().refreshOpen(); await get().refresh() }
  },

  async reorder(id, from, to) {
    if (id !== get().openId || from === to || get().saving) return
    const before = get().openTracks
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0 || from >= before.length || to >= before.length) return

    // Reorder locally first so the drag feels instant, then persist. A round
    // trip before repainting makes drag-to-reorder feel broken.
    const tracks = [...before]
    const [moved] = tracks.splice(from, 1)
    if (moved) tracks.splice(to, 0, moved)
    set({ openTracks: tracks, saving: true })
    openToken++
    try {
      await window.resonance.playlists.reorder(id, from, to)
    } catch (error) {
      if (get().openId === id) set({ openTracks: before })
      throw error
    } finally {
      set({ saving: false })
      await get().refreshOpen()
      await get().refresh()
    }
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
