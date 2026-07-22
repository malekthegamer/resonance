import { join } from 'node:path'
import { app, BrowserWindow, ipcMain } from 'electron'
import { IPC } from '@shared/ipc'
import type { AppInfo, DbInfo, Settings } from '@shared/types'
import { createMainWindow, getMainWindow, markQuitting } from './windows/main'
import { getAllSettings, getSetting, setSetting } from './settings'
import { closeDb, getDb, getDbInfo } from './db/open'
import { registerLibraryIpc } from './ipc/library'
import { registerPlaylistIpc } from './ipc/playlists'
import { registerDesktopIpc } from './ipc/desktop'
import { createTray, destroyTray } from './tray'
import { registerGlobalShortcuts, unregisterGlobalShortcuts } from './shortcuts'
import { closeMiniPlayer } from './windows/mini'
import { registerProtocolHandlers, registerSchemes } from './protocol'

// Must run before app.whenReady() — privileged scheme registration is only
// honoured at this point in the lifecycle (plan §A2a).
registerSchemes()

// Must run before any app.getPath('userData') call.
//
// setName alone is not enough: Electron resolves userData from the app name
// before this executes, so in development it stays %APPDATA%\Electron. Setting
// the path explicitly makes dev and packaged builds agree on one location —
// otherwise the library you build in dev is not the library the installed app
// opens, and relocating it later orphans a real user's library.
app.setName('Resonance')

// An explicit --user-data-dir must win. Unconditionally calling setPath here
// silently overrode it, so the e2e suite scanned its fixtures into the real
// library instead of an isolated one.
if (!app.commandLine.getSwitchValue('user-data-dir')) {
  app.setPath('userData', join(app.getPath('appData'), 'Resonance'))
}

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
    // Open (and migrate) the library DB before any window can query it. Doing
    // this eagerly means a schema problem surfaces at launch rather than on the
    // first library interaction.
    const info = getDbInfo()
    console.log(
      `[db] sqlite ${info.sqlite} · schema v${info.schemaVersion}/${info.expectedSchemaVersion} · ` +
        `journal=${info.journalMode} · tables=[${info.tables.join(', ')}] · tracks=${info.trackCount}`
    )
    console.log(`[db] ${info.path}`)

    registerProtocolHandlers()
    registerIpc()
    registerLibraryIpc()
    registerPlaylistIpc()
    registerDesktopIpc()
    createMainWindow()
    createTray()

    // Registration failures are captured, not thrown: media keys are commonly
    // owned by another app, and that is surfaced in Settings rather than
    // crashing or silently doing nothing.
    const shortcuts = registerGlobalShortcuts()
    const failed = shortcuts.filter((s) => !s.registered)
    if (failed.length) {
      console.warn(
        `[shortcuts] ${failed.length} of ${shortcuts.length} could not be registered ` +
          `(likely owned by another app): ${failed.map((s) => s.accelerator).join(', ')}`
      )
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
    })
  })

  // With minimize-to-tray on, closing the last window hides the app rather than
  // quitting it — the tray icon is what keeps it reachable.
  app.on('window-all-closed', () => {
    if (getSetting('minimizeToTray')) return
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', () => {
    markQuitting()
    unregisterGlobalShortcuts()
    closeMiniPlayer()
    destroyTray()
  })

  // Close the DB cleanly so WAL is checkpointed rather than left for recovery.
  app.on('will-quit', closeDb)
}

function sqliteVersion(): string | null {
  try {
    return getDb().sqliteVersion
  } catch {
    return null
  }
}

function registerIpc(): void {
  ipcMain.handle(IPC.DB_INFO, (): DbInfo => getDbInfo())

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
