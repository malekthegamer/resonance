import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import electronUpdater from 'electron-updater'
import { IPC } from '@shared/ipc'
import type { UpdateStatus } from '@shared/types'

/**
 * Auto-update against GitHub Releases.
 *
 * The repo comes from `repository` in package.json, which electron-builder bakes
 * into app-update.yml at build time — there is no hardcoded owner/name to drift.
 *
 * Downloads happen in the background and install on quit, so an update never
 * interrupts playback. `autoInstallOnAppQuit` is what makes that work: the
 * installer runs after the user closes the app, not while they are using it.
 */

const { autoUpdater } = electronUpdater

let status: UpdateStatus = { state: 'idle' }
let checkedThisSession = false

function broadcast(next: UpdateStatus): void {
  status = next
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(IPC.UPDATE_STATUS, next)
  }
}

export function getUpdateStatus(): UpdateStatus {
  return status
}

export function setupUpdater(): void {
  // Updates only make sense for an installed build. In development the version
  // is whatever package.json says and there is nothing to update from; the
  // portable build has no installer to run either.
  const enabled = app.isPackaged && process.env['RESONANCE_DISABLE_UPDATER'] !== '1'

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  // Pre-releases are for testing; friends should only ever see stable builds.
  autoUpdater.allowPrerelease = false

  autoUpdater.on('checking-for-update', () => broadcast({ state: 'checking' }))
  autoUpdater.on('update-not-available', () => broadcast({ state: 'idle' }))

  autoUpdater.on('update-available', (info) =>
    broadcast({ state: 'downloading', version: info.version, percent: 0 })
  )

  autoUpdater.on('download-progress', (progress) =>
    broadcast({
      state: 'downloading',
      version: status.version ?? '',
      percent: Math.round(progress.percent)
    })
  )

  autoUpdater.on('update-downloaded', (info) =>
    broadcast({ state: 'ready', version: info.version })
  )

  autoUpdater.on('error', (err) => {
    // A failed update check must never be fatal — no network, a rate limit, or
    // a repo with no releases yet are all normal.
    broadcast({ state: 'error', message: err?.message ?? 'Update check failed' })
  })

  ipcMain.handle(IPC.UPDATE_STATUS_GET, (): UpdateStatus => status)

  ipcMain.handle(IPC.UPDATE_CHECK, async (): Promise<UpdateStatus> => {
    if (!enabled) {
      return { state: 'disabled', message: 'Updates apply to installed builds only' }
    }
    try {
      await autoUpdater.checkForUpdates()
    } catch (err) {
      broadcast({
        state: 'error',
        message: err instanceof Error ? err.message : 'Update check failed'
      })
    }
    return status
  })

  ipcMain.handle(IPC.UPDATE_INSTALL, async (): Promise<void> => {
    if (status.state !== 'ready') return
    const win = BrowserWindow.getAllWindows()[0]
    const answer = win
      ? await dialog.showMessageBox(win, {
          type: 'question',
          buttons: ['Restart now', 'Later'],
          defaultId: 0,
          cancelId: 1,
          title: 'Update ready',
          message: `Resonance ${status.version} is ready to install.`,
          detail: 'The app will restart. Your library and playlists are unaffected.'
        })
      : { response: 0 }

    if (answer.response === 0) {
      // isSilent = false so the user sees the installer; isForceRunAfter = true
      // so the app comes back up rather than leaving them staring at a closed
      // window.
      autoUpdater.quitAndInstall(false, true)
    }
  })

  if (!enabled) {
    status = { state: 'disabled', message: 'Updates apply to installed builds only' }
    return
  }

  // Checked once shortly after launch, not on a timer: startup is already busy
  // opening the database and restoring the session, and a music player is not
  // something people leave running for weeks between restarts.
  app.whenReady().then(() => {
    setTimeout(() => {
      if (checkedThisSession) return
      checkedThisSession = true
      void autoUpdater.checkForUpdates().catch(() => {
        /* handled by the error listener */
      })
    }, 4000)
  })
}
