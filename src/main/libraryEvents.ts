import { BrowserWindow } from 'electron'
import { IPC } from '@shared/ipc'

export function libraryChanged(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(IPC.LIB_CHANGED)
  }
}
