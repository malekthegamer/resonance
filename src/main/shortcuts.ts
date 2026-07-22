import { globalShortcut } from 'electron'
import { IPC } from '@shared/ipc'
import { getMainWindow } from './windows/main'

/**
 * Global media keys and shortcuts, so playback works while Resonance is in the
 * background.
 *
 * `globalShortcut.register` returns false when another application already owns
 * an accelerator — a very common situation for media keys, since browsers and
 * other players grab them too. That result is captured and surfaced in Settings
 * rather than swallowed: a media key that silently does nothing looks like a bug
 * in Resonance when it is actually a conflict.
 */

export interface ShortcutStatus {
  accelerator: string
  action: string
  registered: boolean
}

const BINDINGS: Array<{ accelerator: string; action: string; channel: string }> = [
  { accelerator: 'MediaPlayPause', action: 'Play / Pause', channel: IPC.MEDIA_PLAY_PAUSE },
  { accelerator: 'MediaNextTrack', action: 'Next track', channel: IPC.MEDIA_NEXT },
  { accelerator: 'MediaPreviousTrack', action: 'Previous track', channel: IPC.MEDIA_PREVIOUS },
  { accelerator: 'MediaStop', action: 'Stop', channel: IPC.MEDIA_STOP },
  { accelerator: 'CommandOrControl+Alt+Up', action: 'Volume up', channel: IPC.MEDIA_VOLUME_UP },
  { accelerator: 'CommandOrControl+Alt+Down', action: 'Volume down', channel: IPC.MEDIA_VOLUME_DOWN }
]

let status: ShortcutStatus[] = []

export function registerGlobalShortcuts(): ShortcutStatus[] {
  unregisterGlobalShortcuts()

  status = BINDINGS.map(({ accelerator, action, channel }) => {
    let registered = false
    try {
      registered = globalShortcut.register(accelerator, () => {
        getMainWindow()?.webContents.send(channel)
      })
    } catch {
      registered = false
    }
    return { accelerator, action, registered }
  })

  return status
}

export function getShortcutStatus(): ShortcutStatus[] {
  return status
}

export function unregisterGlobalShortcuts(): void {
  globalShortcut.unregisterAll()
  status = []
}
