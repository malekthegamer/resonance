import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IPC } from '@shared/ipc'
import type {
  AppInfo,
  DbInfo,
  NowPlayingState,
  ScanProgress,
  Settings,
  Track
} from '@shared/types'
import type { LibraryStats } from '../main/ipc/library'
import type { ImportResult } from '../main/ipc/playlists'
import type { PlaylistSummary } from '../main/db/playlists'
import type { ShortcutStatus } from '../main/shortcuts'

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

  library: {
    dbInfo: (): Promise<DbInfo> => ipcRenderer.invoke(IPC.DB_INFO),
    pickAndScan: (): Promise<ScanProgress | null> => ipcRenderer.invoke(IPC.LIB_PICK_AND_SCAN),
    scanPaths: (paths: string[]): Promise<ScanProgress> =>
      ipcRenderer.invoke(IPC.LIB_SCAN_PATHS, paths),
    cancelScan: (): void => ipcRenderer.send(IPC.LIB_CANCEL_SCAN),
    getTracks: (): Promise<Track[]> => ipcRenderer.invoke(IPC.LIB_GET_TRACKS),
    search: (query: string): Promise<Track[]> => ipcRenderer.invoke(IPC.LIB_SEARCH, query),
    stats: (): Promise<LibraryStats> => ipcRenderer.invoke(IPC.LIB_STATS),
    onScanProgress: (cb: (p: ScanProgress) => void): (() => void) => {
      const listener = (_e: unknown, p: ScanProgress): void => cb(p)
      ipcRenderer.on(IPC.LIB_SCAN_PROGRESS, listener)
      return () => {
        ipcRenderer.removeListener(IPC.LIB_SCAN_PROGRESS, listener)
      }
    }
  },

  playlists: {
    list: (): Promise<PlaylistSummary[]> => ipcRenderer.invoke(IPC.PL_LIST),
    create: (name: string): Promise<number> => ipcRenderer.invoke(IPC.PL_CREATE, name),
    rename: (id: number, name: string): Promise<void> =>
      ipcRenderer.invoke(IPC.PL_RENAME, id, name),
    remove: (id: number): Promise<void> => ipcRenderer.invoke(IPC.PL_DELETE, id),
    tracks: (id: number): Promise<Track[]> => ipcRenderer.invoke(IPC.PL_TRACKS, id),
    addTracks: (id: number, trackIds: number[]): Promise<number> =>
      ipcRenderer.invoke(IPC.PL_ADD, id, trackIds),
    removeAt: (id: number, position: number): Promise<void> =>
      ipcRenderer.invoke(IPC.PL_REMOVE, id, position),
    reorder: (id: number, from: number, to: number): Promise<void> =>
      ipcRenderer.invoke(IPC.PL_REORDER, id, from, to),
    importFiles: (paths?: string[]): Promise<ImportResult[]> =>
      ipcRenderer.invoke(IPC.PL_IMPORT, paths),
    exportPlaylist: (id: number): Promise<string | null> => ipcRenderer.invoke(IPC.PL_EXPORT, id)
  },

  tracks: {
    revealInFolder: (trackId: number): Promise<boolean> =>
      ipcRenderer.invoke(IPC.TRACK_REVEAL, trackId),
    recordPlay: (trackId: number): Promise<void> => ipcRenderer.invoke(IPC.TRACK_PLAYED, trackId)
  },

  /**
   * Resolves dropped File objects to real filesystem paths.
   *
   * Electron removed `File.path` in v32, so this is the supported route. It must
   * happen in the preload — `webUtils` is not available to the sandboxed
   * renderer, which is the point: the renderer can only learn the path of a file
   * the user themselves dropped onto the window.
   */
  files: {
    getPaths: (files: File[]): string[] =>
      files.map((f) => webUtils.getPathForFile(f)).filter(Boolean)
  },

  desktop: {
    /** Main window pushes now-playing state; main fans it out. */
    publishNowPlaying: (state: NowPlayingState): void =>
      ipcRenderer.send(IPC.NOW_PLAYING_CHANGED, state),
    /** Main asks the audio-owning window to re-publish (mini-player opened). */
    onNowPlayingRequest: (cb: () => void): (() => void) => {
      const listener = (): void => cb()
      ipcRenderer.on(IPC.NOW_PLAYING_REQUEST, listener)
      return () => ipcRenderer.removeListener(IPC.NOW_PLAYING_REQUEST, listener)
    },
    onNowPlaying: (cb: (s: NowPlayingState) => void): (() => void) => {
      const listener = (_e: unknown, s: NowPlayingState): void => cb(s)
      ipcRenderer.on(IPC.NOW_PLAYING_STATE, listener)
      return () => ipcRenderer.removeListener(IPC.NOW_PLAYING_STATE, listener)
    },

    /** Media keys and tray commands arriving from main. */
    onMediaCommand: (
      cb: (command: 'playPause' | 'next' | 'previous' | 'stop' | 'volumeUp' | 'volumeDown') => void
    ): (() => void) => {
      const map: Array<[string, Parameters<typeof cb>[0]]> = [
        [IPC.MEDIA_PLAY_PAUSE, 'playPause'],
        [IPC.MEDIA_NEXT, 'next'],
        [IPC.MEDIA_PREVIOUS, 'previous'],
        [IPC.MEDIA_STOP, 'stop'],
        [IPC.MEDIA_VOLUME_UP, 'volumeUp'],
        [IPC.MEDIA_VOLUME_DOWN, 'volumeDown']
      ]
      const listeners = map.map(([channel, command]) => {
        const l = (): void => cb(command)
        ipcRenderer.on(channel, l)
        return [channel, l] as const
      })
      return () => {
        for (const [channel, l] of listeners) ipcRenderer.removeListener(channel, l)
      }
    },

    /** Mini-player sends commands back to the window that owns audio. */
    sendMediaCommand: (
      command: 'playPause' | 'next' | 'previous' | 'stop' | 'volumeUp' | 'volumeDown'
    ): void => {
      const channels = {
        playPause: IPC.MEDIA_PLAY_PAUSE,
        next: IPC.MEDIA_NEXT,
        previous: IPC.MEDIA_PREVIOUS,
        stop: IPC.MEDIA_STOP,
        volumeUp: IPC.MEDIA_VOLUME_UP,
        volumeDown: IPC.MEDIA_VOLUME_DOWN
      }
      ipcRenderer.send(channels[command])
    },

    toggleMiniPlayer: (): Promise<boolean> => ipcRenderer.invoke(IPC.MINI_TOGGLE),
    isMiniPlayerOpen: (): Promise<boolean> => ipcRenderer.invoke(IPC.MINI_IS_OPEN),
    closeMiniPlayer: (): void => ipcRenderer.send(IPC.MINI_CLOSE),
    shortcutStatus: (): Promise<ShortcutStatus[]> => ipcRenderer.invoke(IPC.SHORTCUT_STATUS)
  },

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
