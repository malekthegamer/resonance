import { app, BrowserWindow, ipcMain } from 'electron'
import { IPC } from '@shared/ipc'
import type { AppInfo, Settings } from '@shared/types'
import { createMainWindow, getMainWindow } from './windows/main'
import { getAllSettings, getSetting, setSetting } from './settings'

// Only one Resonance. A second launch focuses the existing window instead of
// opening a rival instance that would fight over the library DB and the tray.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = getMainWindow()
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  void app.whenReady().then(() => {
    registerIpc()
    createMainWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
    })
  })

  app.on('window-all-closed', () => {
    // Slice 7 introduces minimize-to-tray, which will make this conditional.
    if (process.platform !== 'darwin') app.quit()
  })
}

function sqliteVersion(): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { DatabaseSync } = require('node:sqlite')
    const db = new DatabaseSync(':memory:')
    const row = db.prepare('SELECT sqlite_version() AS v').get() as { v: string }
    db.close()
    return row.v
  } catch {
    return null
  }
}

function registerIpc(): void {
  ipcMain.handle(IPC.PING, (): string => 'pong')

  ipcMain.handle(IPC.APP_INFO, (): AppInfo => {
    return {
      name: 'Resonance',
      version: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      sqlite: sqliteVersion()
    }
  })

  ipcMain.handle(IPC.SETTINGS_GET, (): Settings => getAllSettings())

  ipcMain.handle(IPC.SETTINGS_SET, (_e, key: keyof Settings, value: Settings[keyof Settings]) => {
    setSetting(key, value as never)
    return getSetting(key)
  })

  // Window controls for the custom chrome. `BrowserWindow.fromWebContents`
  // rather than the module-level reference so these also serve the mini-player
  // window in slice 7 without a second set of channels.
  ipcMain.on(IPC.WIN_MINIMIZE, (e) => BrowserWindow.fromWebContents(e.sender)?.minimize())

  ipcMain.on(IPC.WIN_TOGGLE_MAXIMIZE, (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })

  ipcMain.on(IPC.WIN_CLOSE, (e) => BrowserWindow.fromWebContents(e.sender)?.close())

  ipcMain.handle(IPC.WIN_IS_MAXIMIZED, (e): boolean => {
    return BrowserWindow.fromWebContents(e.sender)?.isMaximized() ?? false
  })
}
