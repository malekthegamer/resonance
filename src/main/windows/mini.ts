import { join } from 'node:path'
import { BrowserWindow, screen } from 'electron'
import { getSetting, setSetting } from '../settings'
import { IPC } from '@shared/ipc'
import { getMainWindow } from './main'

/**
 * Compact always-on-top mini-player.
 *
 * It is a remote control, NOT a second player: the audio graph lives only in the
 * main window. Two windows each owning an AudioContext would produce genuine
 * double playback, which is obvious in hindsight and miserable to retrofit.
 * Commands go through main to the main window; state comes back the same way.
 */

const WIDTH = 380
const HEIGHT = 132

let miniWindow: BrowserWindow | null = null

export function getMiniWindow(): BrowserWindow | null {
  return miniWindow
}

export function isMiniOpen(): boolean {
  return miniWindow !== null && !miniWindow.isDestroyed()
}

function savedPosition(): { x?: number; y?: number } {
  const saved = getSetting('miniPlayerPosition')
  if (!saved || typeof saved.x !== 'number' || typeof saved.y !== 'number') return {}

  // Same display-validation as the main window: a position left over from a
  // disconnected monitor would put the mini-player off-screen, where it looks
  // like the button did nothing.
  const visible = screen.getAllDisplays().some((d) => {
    const wa = d.workArea
    return (
      saved.x! < wa.x + wa.width &&
      saved.x! + WIDTH > wa.x &&
      saved.y! < wa.y + wa.height &&
      saved.y! + HEIGHT > wa.y
    )
  })
  return visible ? { x: saved.x, y: saved.y } : {}
}

export function openMiniPlayer(): BrowserWindow {
  if (miniWindow && !miniWindow.isDestroyed()) {
    miniWindow.focus()
    return miniWindow
  }

  const pos = savedPosition()

  miniWindow = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    x: pos.x,
    y: pos.y,
    frame: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: '#0d0d14',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  miniWindow.once('ready-to-show', () => {
    miniWindow?.show()
    // Re-assert after the window is on screen. Windows can decline a topmost
    // request from a process that is not in the foreground, and the constructor
    // flag is evaluated before the window exists visually. This is best-effort,
    // not a guarantee — the OS has the final say.
    miniWindow?.setAlwaysOnTop(true)
    // Ask the window that owns audio to re-publish immediately. Without this the
    // mini-player shows "Nothing playing" until the next state change, which for
    // a paused track means indefinitely.
    getMainWindow()?.webContents.send(IPC.NOW_PLAYING_REQUEST)
  })

  let saveTimer: NodeJS.Timeout | null = null
  miniWindow.on('move', () => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      if (!miniWindow || miniWindow.isDestroyed()) return
      const [x, y] = miniWindow.getPosition()
      setSetting('miniPlayerPosition', { x, y })
    }, 350)
  })

  miniWindow.on('closed', () => {
    if (saveTimer) clearTimeout(saveTimer)
    miniWindow = null
    // Bring the main window back so closing the mini-player never leaves the
    // app running with no visible window.
    const main = getMainWindow()
    if (main && !main.isVisible()) main.show()
  })

  // Same bundle, different route — the renderer switches on this.
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) void miniWindow.loadURL(`${devUrl}?window=mini`)
  else {
    void miniWindow.loadFile(join(__dirname, '../renderer/index.html'), { search: '?window=mini' })
  }

  return miniWindow
}

export function closeMiniPlayer(): void {
  if (miniWindow && !miniWindow.isDestroyed()) miniWindow.close()
  miniWindow = null
}

/** Swaps between the main window and the mini-player. */
export function toggleMiniPlayer(): boolean {
  const main = getMainWindow()
  if (isMiniOpen()) {
    closeMiniPlayer()
    main?.show()
    return false
  }
  openMiniPlayer()
  main?.hide()
  return true
}
