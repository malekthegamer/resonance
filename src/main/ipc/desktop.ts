import { BrowserWindow, ipcMain } from 'electron'
import { IPC } from '@shared/ipc'
import type { NowPlayingState } from '@shared/types'
import { getShortcutStatus, type ShortcutStatus } from '../shortcuts'
import { updateTrayNowPlaying } from '../tray'
import { closeMiniPlayer, getMiniWindow, isMiniOpen, toggleMiniPlayer } from '../windows/mini'
import { getMainWindow } from '../windows/main'

/**
 * Desktop integration IPC: now-playing broadcast, mini-player, shortcut status.
 *
 * Only the main window owns the audio graph, so it is the single source of
 * now-playing truth. It pushes state here; main fans it out to the tray tooltip
 * and the mini-player. The mini-player never computes state of its own.
 */
export function registerDesktopIpc(): void {
  ipcMain.on(IPC.NOW_PLAYING_CHANGED, (_e, state: NowPlayingState) => {
    updateTrayNowPlaying(
      state.trackId != null ? { title: state.title, artist: state.artist } : null,
      state.playing
    )

    const mini = getMiniWindow()
    if (mini && !mini.isDestroyed()) mini.webContents.send(IPC.NOW_PLAYING_STATE, state)
  })

  // Commands from the mini-player are relayed to the window that owns audio.
  for (const channel of [
    IPC.MEDIA_PLAY_PAUSE,
    IPC.MEDIA_NEXT,
    IPC.MEDIA_PREVIOUS,
    IPC.MEDIA_STOP,
    IPC.MEDIA_VOLUME_UP,
    IPC.MEDIA_VOLUME_DOWN
  ]) {
    ipcMain.on(channel, (e) => {
      const main = getMainWindow()
      // Ignore an echo from the main window itself.
      if (main && main.webContents.id !== e.sender.id) main.webContents.send(channel)
    })
  }

  ipcMain.handle(IPC.MINI_TOGGLE, (): boolean => toggleMiniPlayer())
  ipcMain.handle(IPC.MINI_IS_OPEN, (): boolean => isMiniOpen())
  ipcMain.on(IPC.MINI_CLOSE, () => {
    closeMiniPlayer()
    getMainWindow()?.show()
  })

  ipcMain.handle(IPC.SHORTCUT_STATUS, (): ShortcutStatus[] => getShortcutStatus())
}

/** True when the sender is the mini-player window. */
export function isMiniSender(e: { sender: Electron.WebContents }): boolean {
  return BrowserWindow.fromWebContents(e.sender) === getMiniWindow()
}
