/** Types shared across main, preload, and renderer. */

export type Theme = 'dark' | 'light'

export interface AppInfo {
  name: string
  version: string
  electron: string
  chrome: string
  node: string
  /** SQLite version reported by node:sqlite, proven at runtime rather than assumed. */
  sqlite: string | null
}

/** Persisted main-window geometry (see plan §A5). */
export interface WindowState {
  x?: number
  y?: number
  width: number
  height: number
  isMaximized: boolean
}

export interface Settings {
  theme: Theme
  windowState: WindowState
}

export const DEFAULT_WINDOW_STATE: WindowState = {
  width: 1280,
  height: 820,
  isMaximized: false
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  windowState: DEFAULT_WINDOW_STATE
}
