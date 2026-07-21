import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '@shared/ipc'
import type { AppInfo, Settings } from '@shared/types'

/**
 * The only bridge between main and renderer.
 *
 * Deliberately narrow: each function is a named capability, never a generic
 * `invoke(channel, ...args)` passthrough. Exposing a generic invoke would hand a
 * compromised renderer the entire main-process API surface and defeat the point
 * of contextIsolation.
 */
const api = {
  ping: (): Promise<string> => ipcRenderer.invoke(IPC.PING),
  getAppInfo: (): Promise<AppInfo> => ipcRenderer.invoke(IPC.APP_INFO),

  settings: {
    getAll: (): Promise<Settings> => ipcRenderer.invoke(IPC.SETTINGS_GET),
    set: <K extends keyof Settings>(key: K, value: Settings[K]): Promise<Settings[K]> =>
      ipcRenderer.invoke(IPC.SETTINGS_SET, key, value)
  },

  window: {
    minimize: (): void => ipcRenderer.send(IPC.WIN_MINIMIZE),
    toggleMaximize: (): void => ipcRenderer.send(IPC.WIN_TOGGLE_MAXIMIZE),
    close: (): void => ipcRenderer.send(IPC.WIN_CLOSE),
    isMaximized: (): Promise<boolean> => ipcRenderer.invoke(IPC.WIN_IS_MAXIMIZED),
    /** Returns an unsubscribe function — leaked listeners are a real leak source. */
    onMaximizeChanged: (cb: (isMaximized: boolean) => void): (() => void) => {
      const listener = (_e: unknown, isMaximized: boolean): void => cb(isMaximized)
      ipcRenderer.on(IPC.WIN_MAXIMIZE_CHANGED, listener)
      return () => {
        ipcRenderer.removeListener(IPC.WIN_MAXIMIZE_CHANGED, listener)
      }
    }
  }
}

export type ResonanceApi = typeof api

contextBridge.exposeInMainWorld('resonance', api)
