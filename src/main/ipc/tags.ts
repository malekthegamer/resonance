import { join } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { IPC } from '@shared/ipc'
import type { ScanProgress } from '@shared/types'
import { getDb } from '../db/open'
import { getTrackById } from '../db/tracks'
import { isScanning, scanFolders } from '../scan/controller'
import {
  knownPaths,
  readTags,
  writeTags,
  type TagReadResult,
  type TagValues,
  type TagWriteResult
} from '../tags'

/**
 * The tag channel.
 *
 * Takes track *ids*, never paths. The renderer has no business naming files on
 * disk for the main process to rewrite, and resolving ids through the database
 * means a write can only ever land on something already in the library.
 */

export interface TagWriteReport {
  results: TagWriteResult[]
  written: number
  failed: number
  /** Progress of the rescan that folded the new tags back into the database. */
  rescan: ScanProgress | null
}

/**
 * Originals live beside the database in `%APPDATA%\Resonance`, which is the
 * user's own directory and already survives uninstall by design.
 */
export function tagBackupDir(): string {
  return join(app.getPath('userData'), 'tag-backups')
}

function broadcast(progress: ScanProgress): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(IPC.LIB_SCAN_PROGRESS, progress)
  }
}

function pathsForIds(ids: readonly number[]): string[] {
  const db = getDb()
  const paths: string[] = []
  for (const id of ids) {
    const track = getTrackById(db, id)
    if (track) paths.push(track.path)
  }
  // Belt and braces: ids came from the database, so this cannot currently
  // reject anything. It stays because it is the check that has to hold if a
  // future caller ever passes paths straight through.
  return knownPaths(db, paths)
}

export function registerTagIpc(): void {
  ipcMain.handle(IPC.TAGS_READ, (_e, trackIds: number[]): TagReadResult[] => {
    return readTags(pathsForIds(Array.isArray(trackIds) ? trackIds : []))
  })

  ipcMain.handle(
    IPC.TAGS_WRITE,
    async (
      _e,
      trackIds: number[],
      changes: TagValues,
      artworkPath?: string | null
    ): Promise<TagWriteReport> => {
      const paths = pathsForIds(Array.isArray(trackIds) ? trackIds : [])
      const results = writeTags(paths, changes ?? {}, {
        backupRoot: tagBackupDir(),
        artworkPath
      })
      const written = results.filter((r) => r.ok).map((r) => r.path)

      /*
       * Fold the changes back in through the ordinary scanner rather than
       * patching the rows directly. Writing tags changes the file's mtime, so
       * the scanner's mtime-skip lets these files through, and the database,
       * the FTS index and the art cache all update by the one code path that is
       * already known to work.
       */
      let rescan: ScanProgress | null = null
      if (written.length > 0 && !isScanning()) {
        try {
          rescan = await scanFolders(written, { onProgress: broadcast })
        } catch {
          // A rescan that fails leaves the files correctly tagged and the
          // database stale — worth reporting, not worth failing the write over.
          rescan = null
        }
      }

      return {
        results,
        written: written.length,
        failed: results.length - written.length,
        rescan
      }
    }
  )

  ipcMain.handle(IPC.TAGS_PICK_ARTWORK, async (e): Promise<string | null> => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const result = await dialog.showOpenDialog(win!, {
      title: 'Choose cover art',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'] }]
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0] ?? null
  })
}
