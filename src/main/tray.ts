import { join } from 'node:path'
import { app, Menu, nativeImage, Tray } from 'electron'
import { IPC } from '@shared/ipc'
import { getMainWindow } from './windows/main'

/**
 * System tray icon and quick controls — the feature Windows Media Player lacks.
 *
 * The Tray instance is held in module scope deliberately. A Tray that is only
 * referenced by a local variable gets garbage-collected and the icon silently
 * disappears from the notification area after a few seconds; it is one of the
 * best-known Electron gotchas.
 */

let tray: Tray | null = null
let nowPlaying: { title: string; artist: string } | null = null
let isPlaying = false

function iconPath(name: string): string {
  // Packaged builds keep `build/` under resources; dev runs from the repo root.
  return app.isPackaged
    ? join(process.resourcesPath, name)
    : join(app.getAppPath(), 'build', name)
}

function send(channel: string): void {
  getMainWindow()?.webContents.send(channel)
}

function showApp(): void {
  const win = getMainWindow()
  if (!win) return
  if (win.isMinimized()) win.restore()
  if (!win.isVisible()) win.show()
  win.focus()
}

function tooltip(): string {
  if (!nowPlaying) return 'Resonance'
  const artist = nowPlaying.artist.trim()
  // Windows truncates tray tooltips at 127 characters.
  const text = artist ? `♪ ${artist} – ${nowPlaying.title}` : `♪ ${nowPlaying.title}`
  return text.length > 120 ? text.slice(0, 119) + '…' : text
}

function buildMenu(): Menu {
  return Menu.buildFromTemplate([
    {
      label: nowPlaying ? `♪ ${nowPlaying.title}` : 'Nothing playing',
      enabled: false
    },
    ...(nowPlaying && nowPlaying.artist
      ? [{ label: `   ${nowPlaying.artist}`, enabled: false }]
      : []),
    { type: 'separator' },
    { label: isPlaying ? 'Pause' : 'Play', click: () => send(IPC.MEDIA_PLAY_PAUSE) },
    { label: 'Next', click: () => send(IPC.MEDIA_NEXT) },
    { label: 'Previous', click: () => send(IPC.MEDIA_PREVIOUS) },
    { type: 'separator' },
    { label: 'Show Resonance', click: showApp },
    {
      label: 'Quit',
      click: () => {
        // Bypasses minimize-to-tray, which would otherwise swallow the close.
        app.exit(0)
      }
    }
  ])
}

function refresh(): void {
  if (!tray) return
  tray.setToolTip(tooltip())
  tray.setContextMenu(buildMenu())
}

export function createTray(): void {
  if (tray) return

  const image = nativeImage.createFromPath(iconPath('tray.png'))
  tray = new Tray(image.isEmpty() ? nativeImage.createFromPath(iconPath('icon-32.png')) : image)

  tray.setToolTip('Resonance')
  tray.setContextMenu(buildMenu())

  // Single click on Windows raises the app; double-click does too, and Electron
  // fires both, so only 'click' is handled to avoid a double-raise.
  tray.on('click', showApp)
}

export function updateTrayNowPlaying(
  track: { title: string; artist: string } | null,
  playing: boolean
): void {
  nowPlaying = track
  isPlaying = playing
  refresh()
}

export function destroyTray(): void {
  tray?.destroy()
  tray = null
}
