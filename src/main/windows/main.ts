import { join } from 'node:path'
import { BrowserWindow, screen, shell } from 'electron'
import { IPC } from '@shared/ipc'
import { DEFAULT_WINDOW_STATE, type WindowState } from '@shared/types'
import { getSetting, setSetting } from '../settings'

/**
 * Owns the main window, including window-state persistence (plan §A5).
 *
 * Geometry is saved debounced and restored before first paint. Saved bounds are
 * validated against currently connected displays: a rectangle left over from an
 * unplugged monitor would otherwise restore the window off-screen, where the app
 * looks like it simply failed to launch.
 */

const MIN_WIDTH = 940
const MIN_HEIGHT = 600
const SAVE_DEBOUNCE_MS = 400
/** How close to the top edge counts as a drag-to-top maximize gesture. */
const SNAP_TOP_THRESHOLD_PX = 8

let mainWindow: BrowserWindow | null = null
let saveTimer: NodeJS.Timeout | null = null
/** Set once a real quit is under way, so close-to-tray stops intercepting. */
let isQuitting = false

export function markQuitting(): void {
  isQuitting = true
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

/**
 * Returns saved bounds only if they still land on a connected display.
 * Falls back to centered defaults otherwise.
 */
function resolveStartupBounds(): WindowState {
  const saved = { ...DEFAULT_WINDOW_STATE, ...(getSetting('windowState') ?? {}) }

  const width = Math.max(MIN_WIDTH, Math.round(saved.width) || DEFAULT_WINDOW_STATE.width)
  const height = Math.max(MIN_HEIGHT, Math.round(saved.height) || DEFAULT_WINDOW_STATE.height)

  if (typeof saved.x !== 'number' || typeof saved.y !== 'number') {
    return { width, height, isMaximized: !!saved.isMaximized }
  }

  // The saved rectangle must genuinely overlap some display's work area.
  const visible = screen.getAllDisplays().some((display) => {
    const wa = display.workArea
    return (
      saved.x! < wa.x + wa.width &&
      saved.x! + width > wa.x &&
      saved.y! < wa.y + wa.height &&
      saved.y! + height > wa.y
    )
  })

  if (!visible) {
    return { width, height, isMaximized: !!saved.isMaximized }
  }

  return { x: saved.x, y: saved.y, width, height, isMaximized: !!saved.isMaximized }
}

function persistWindowState(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return

  const isMaximized = mainWindow.isMaximized()
  // Store the *restored* bounds even while maximized, so un-maximizing later
  // returns to a sensible size rather than a full-screen rectangle.
  const bounds = mainWindow.getNormalBounds()

  setSetting('windowState', {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    isMaximized
  })
}

function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(persistWindowState, SAVE_DEBOUNCE_MS)
}

function notifyMaximizeChanged(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.webContents.send(IPC.WIN_MAXIMIZE_CHANGED, mainWindow.isMaximized())
}

export function createMainWindow(): BrowserWindow {
  const startup = resolveStartupBounds()

  mainWindow = new BrowserWindow({
    x: startup.x,
    y: startup.y,
    width: startup.width,
    height: startup.height,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    // Frameless with custom-drawn controls (plan §A1). The Snap Layouts hover
    // flyout is knowingly forfeited; Win+Arrow, Win+Z, double-click-maximize and
    // drag-to-top all still work.
    frame: false,
    backgroundColor: '#0d0d14',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // The Web Audio graph must be able to start without a user gesture when
      // restoring a session; see plan risk register.
      autoplayPolicy: 'no-user-gesture-required'
    }
  })

  // Created hidden and shown on ready-to-show so a restored window never
  // visibly jumps from default bounds to saved bounds.
  mainWindow.once('ready-to-show', () => {
    if (!mainWindow) return
    if (startup.isMaximized) mainWindow.maximize()
    mainWindow.show()
    notifyMaximizeChanged()
  })

  mainWindow.on('resize', scheduleSave)
  mainWindow.on('move', scheduleSave)
  mainWindow.on('maximize', () => {
    scheduleSave()
    notifyMaximizeChanged()
  })
  mainWindow.on('unmaximize', () => {
    scheduleSave()
    notifyMaximizeChanged()
  })

  // Drag-to-top → maximize (plan §A1). 'moved' fires once the drag completes on
  // Windows, so this cannot fire mid-drag.
  mainWindow.on('moved', () => {
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isMaximized()) return
    const cursor = screen.getCursorScreenPoint()
    const display = screen.getDisplayNearestPoint(cursor)
    if (cursor.y <= display.workArea.y + SNAP_TOP_THRESHOLD_PX) {
      mainWindow.maximize()
    }
  })

  // Persist synchronously on close; the debounce may not have fired yet.
  mainWindow.on('close', (event) => {
    if (saveTimer) clearTimeout(saveTimer)
    persistWindowState()

    // Minimize to tray instead of quitting, unless the app is genuinely
    // shutting down (tray "Quit" calls app.exit, which bypasses this entirely).
    if (getSetting('minimizeToTray') && !isQuitting) {
      event.preventDefault()
      mainWindow?.hide()
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // External links open in the real browser, never in the app shell.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    void mainWindow.loadURL(devUrl)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}
