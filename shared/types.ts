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

/** Containers Resonance scans. WMA is best-effort (system codec dependent). */
export const AUDIO_FORMATS = ['mp3', 'flac', 'wav', 'm4a', 'ogg', 'opus', 'wma'] as const
export type AudioFormat = (typeof AUDIO_FORMATS)[number]

/** Maps a lowercase file extension (no dot) to a normalized format. */
export const EXTENSION_FORMATS: Readonly<Record<string, AudioFormat>> = {
  mp3: 'mp3',
  flac: 'flac',
  wav: 'wav',
  wave: 'wav',
  m4a: 'm4a',
  m4b: 'm4a',
  aac: 'm4a',
  mp4: 'm4a',
  ogg: 'ogg',
  oga: 'ogg',
  opus: 'opus',
  wma: 'wma'
}

export interface Track {
  id: number
  path: string
  title: string
  artist: string
  album: string
  albumArtist: string
  genre: string
  year: number | null
  trackNo: number | null
  discNo: number | null
  duration: number
  bitrate: number | null
  sampleRate: number | null
  codec: string | null
  format: string
  size: number
  mtime: number
  artRef: string | null
  dateAdded: number
  playCount: number
  lastPlayed: number | null
  available: boolean
}

export type ScanPhase = 'idle' | 'walking' | 'parsing' | 'done' | 'error' | 'cancelled'

export interface ScanProgress {
  phase: ScanPhase
  filesFound: number
  filesProcessed: number
  inserted: number
  updated: number
  skipped: number
  errors: number
  currentFile: string
  elapsedMs: number
  /** Per-format parsed counts — the §A3 coverage evidence. */
  byFormat: Record<string, number>
}

export const EMPTY_SCAN_PROGRESS: ScanProgress = {
  phase: 'idle',
  filesFound: 0,
  filesProcessed: 0,
  inserted: 0,
  updated: 0,
  skipped: 0,
  errors: 0,
  currentFile: '',
  elapsedMs: 0,
  byFormat: {}
}

/** Runtime evidence about the library database (proven, not assumed). */
export interface DbInfo {
  path: string
  sqlite: string
  schemaVersion: number
  expectedSchemaVersion: number
  journalMode: string
  tables: string[]
  trackCount: number
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
