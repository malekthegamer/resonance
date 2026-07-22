import { readFile, writeFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { IPC } from '@shared/ipc'
import type { Track } from '@shared/types'
import { getDb } from '../db/open'
import {
  addTracksToPlaylist,
  buildPathIndex,
  createPlaylist,
  deletePlaylist,
  normalizePath,
  getPlaylistTracks,
  listPlaylists,
  removeFromPlaylist,
  renamePlaylist,
  reorderPlaylist,
  type PlaylistSummary
} from '../db/playlists'
import { getTrackById } from '../db/tracks'
import { parseM3u, writeM3u } from '../m3u'

export interface ImportResult {
  playlistId: number
  name: string
  matched: number
  missing: number
  missingPaths: string[]
}

export function registerPlaylistIpc(): void {
  ipcMain.handle(IPC.PL_LIST, (): PlaylistSummary[] => listPlaylists(getDb()))

  ipcMain.handle(IPC.PL_CREATE, (_e, name: string): number => createPlaylist(getDb(), name))

  ipcMain.handle(IPC.PL_RENAME, (_e, id: number, name: string): void =>
    renamePlaylist(getDb(), id, name)
  )

  ipcMain.handle(IPC.PL_DELETE, (_e, id: number): void => deletePlaylist(getDb(), id))

  ipcMain.handle(IPC.PL_TRACKS, (_e, id: number): Track[] => getPlaylistTracks(getDb(), id))

  ipcMain.handle(IPC.PL_ADD, (_e, id: number, trackIds: number[]): number =>
    addTracksToPlaylist(getDb(), id, trackIds)
  )

  ipcMain.handle(IPC.PL_REMOVE, (_e, id: number, position: number): void =>
    removeFromPlaylist(getDb(), id, position)
  )

  ipcMain.handle(IPC.PL_REORDER, (_e, id: number, from: number, to: number): void =>
    reorderPlaylist(getDb(), id, from, to)
  )

  /**
   * Imports one or more .m3u/.m3u8 files.
   *
   * Entries that do not resolve to a scanned track are reported rather than
   * dropped silently — a playlist that imports "successfully" with half its
   * tracks missing is worse than one that says so.
   */
  ipcMain.handle(IPC.PL_IMPORT, async (e, paths?: string[]): Promise<ImportResult[]> => {
    let files = paths
    if (!files || files.length === 0) {
      const win = BrowserWindow.fromWebContents(e.sender)
      const picked = await dialog.showOpenDialog(win!, {
        title: 'Import playlists',
        filters: [{ name: 'Playlists', extensions: ['m3u', 'm3u8'] }],
        properties: ['openFile', 'multiSelections']
      })
      if (picked.canceled) return []
      files = picked.filePaths
    }

    const db = getDb()
    const results: ImportResult[] = []

    for (const file of files) {
      let text: string
      try {
        text = await readFile(file, 'utf8')
      } catch {
        continue
      }

      const parsed = parseM3u(text, file)
      const name = parsed.name ?? basename(file).replace(/\.m3u8?$/i, '')
      const playlistId = createPlaylist(db, name)

      // One index for the whole import rather than a query per entry.
      const index = buildPathIndex(db)
      const ids: number[] = []
      const missingPaths: string[] = []
      for (const entry of parsed.entries) {
        const id = index.get(normalizePath(entry.path))
        if (id) ids.push(id)
        else missingPaths.push(entry.path)
      }

      addTracksToPlaylist(db, playlistId, ids)
      results.push({
        playlistId,
        name,
        matched: ids.length,
        missing: missingPaths.length,
        missingPaths: missingPaths.slice(0, 20)
      })
    }

    return results
  })

  ipcMain.handle(IPC.PL_EXPORT, async (e, id: number): Promise<string | null> => {
    const db = getDb()
    const summary = listPlaylists(db).find((p) => p.id === id)
    if (!summary) return null

    const win = BrowserWindow.fromWebContents(e.sender)
    const picked = await dialog.showSaveDialog(win!, {
      title: 'Export playlist',
      defaultPath: `${summary.name.replace(/[\\/:*?"<>|]/g, '_')}.m3u8`,
      filters: [{ name: 'M3U8 playlist', extensions: ['m3u8'] }]
    })
    if (picked.canceled || !picked.filePath) return null

    const tracks = getPlaylistTracks(db, id)
    const text = writeM3u(
      summary.name,
      tracks.map((t) => ({
        path: t.path,
        title: t.title,
        ...(t.artist ? { artist: t.artist } : {}),
        durationSec: t.duration
      }))
    )

    // UTF-8 without BOM: .m3u8 is defined as UTF-8, and a BOM confuses some
    // players into treating the first path as garbage.
    await writeFile(picked.filePath, text, 'utf8')
    return picked.filePath
  })

  /** Reveals a track in Explorer (spec: "Show in folder"). */
  ipcMain.handle(IPC.TRACK_REVEAL, (_e, trackId: number): boolean => {
    const track = getTrackById(getDb(), trackId)
    if (!track) return false
    shell.showItemInFolder(track.path)
    return true
  })

  /** Play-count tracking, which feeds "Most Played". */
  ipcMain.handle(IPC.TRACK_PLAYED, (_e, trackId: number): void => {
    getDb().run(
      'UPDATE tracks SET play_count = play_count + 1, last_played = ? WHERE id = ?',
      [Date.now(), trackId]
    )
  })
}
