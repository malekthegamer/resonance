import { BrowserWindow, dialog, ipcMain } from 'electron'
import { IPC } from '@shared/ipc'
import type { ScanProgress, Track } from '@shared/types'
import { getDb } from '../db/open'
import {
  countTracks,
  countsByFormat,
  getAllTracks,
  searchTracks
} from '../db/tracks'
import { cancelScan, isScanning, scanFolders } from '../scan/controller'

export interface LibraryStats {
  trackCount: number
  byFormat: Record<string, number>
  scanning: boolean
}

/** Progress is broadcast to every window so the mini-player can show it too. */
function broadcast(progress: ScanProgress): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(IPC.LIB_SCAN_PROGRESS, progress)
  }
}

export function registerLibraryIpc(): void {
  ipcMain.handle(IPC.LIB_PICK_AND_SCAN, async (e): Promise<ScanProgress | null> => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const result = await dialog.showOpenDialog(win!, {
      title: 'Add music folders',
      properties: ['openDirectory', 'multiSelections']
    })
    if (result.canceled || result.filePaths.length === 0) return null

    const db = getDb()
    const now = Date.now()
    for (const folder of result.filePaths) {
      db.run('INSERT OR IGNORE INTO watched_folders (path, added_at) VALUES (?, ?)', [folder, now])
    }

    return scanFolders(result.filePaths, { onProgress: broadcast })
  })

  // Used by drag-and-drop, which supplies paths directly rather than via a dialog.
  ipcMain.handle(IPC.LIB_SCAN_PATHS, async (_e, paths: string[]): Promise<ScanProgress> => {
    return scanFolders(paths, { onProgress: broadcast })
  })

  ipcMain.on(IPC.LIB_CANCEL_SCAN, () => cancelScan())

  ipcMain.handle(IPC.LIB_GET_TRACKS, (): Track[] => getAllTracks(getDb()))

  ipcMain.handle(IPC.LIB_SEARCH, (_e, query: string): Track[] =>
    searchTracks(getDb(), String(query ?? ''))
  )

  ipcMain.handle(IPC.LIB_STATS, (): LibraryStats => {
    const db = getDb()
    return {
      trackCount: countTracks(db),
      byFormat: countsByFormat(db),
      scanning: isScanning()
    }
  })
}
