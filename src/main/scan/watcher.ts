import { extname } from 'node:path'
import chokidar, { type FSWatcher } from 'chokidar'
import { EXTENSION_FORMATS } from '@shared/types'
import { getDb } from '../db/open'
import { markUnavailable } from '../db/tracks'

/**
 * Live folder watching.
 *
 * Filesystem events arrive in bursts — copying an album fires dozens of `add`
 * events in a second — so changes are collected and flushed on a debounce
 * instead of triggering a scan per file. Without that, dropping a folder in
 * would start dozens of overlapping scans.
 *
 * Deletions mark tracks unavailable rather than removing them: a temporarily
 * disconnected drive should not destroy playlists and play counts.
 */

const FLUSH_DEBOUNCE_MS = 1500

let watcher: FSWatcher | null = null
let pendingAdds = new Set<string>()
let pendingRemovals = new Set<string>()
let flushTimer: NodeJS.Timeout | null = null

export interface WatcherCallbacks {
  onChanged(addedPaths: string[]): void | Promise<void>
}

function isAudio(path: string): boolean {
  return Boolean(EXTENSION_FORMATS[extname(path).slice(1).toLowerCase()])
}

function scheduleFlush(cb: WatcherCallbacks): void {
  if (flushTimer) clearTimeout(flushTimer)
  flushTimer = setTimeout(() => {
    const added = [...pendingAdds]
    const removed = [...pendingRemovals]
    pendingAdds = new Set()
    pendingRemovals = new Set()

    if (removed.length) {
      try {
        markUnavailable(getDb(), removed)
      } catch {
        /* database may be closing during shutdown */
      }
    }
    if (added.length) void cb.onChanged(added)
  }, FLUSH_DEBOUNCE_MS)
}

export function startWatching(folders: string[], cb: WatcherCallbacks): void {
  stopWatching()
  if (folders.length === 0) return

  watcher = chokidar.watch(folders, {
    ignoreInitial: true,
    // A file is not ready to parse the instant it appears — a copy in progress
    // would be read as a truncated, corrupt file.
    awaitWriteFinish: { stabilityThreshold: 900, pollInterval: 120 },
    depth: 12,
    ignored: (path: string) => /(^|[\\/])(\.|node_modules|\$RECYCLE\.BIN)/i.test(path)
  })

  watcher.on('add', (path: string) => {
    if (!isAudio(path)) return
    pendingAdds.add(path)
    scheduleFlush(cb)
  })

  watcher.on('unlink', (path: string) => {
    if (!isAudio(path)) return
    pendingRemovals.add(path)
    scheduleFlush(cb)
  })

  watcher.on('change', (path: string) => {
    // A re-tagged file needs reparsing; the scanner's mtime check makes this
    // cheap when nothing actually changed.
    if (!isAudio(path)) return
    pendingAdds.add(path)
    scheduleFlush(cb)
  })

  watcher.on('error', () => {
    /* a vanished folder must not crash the app */
  })
}

export function stopWatching(): void {
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  pendingAdds = new Set()
  pendingRemovals = new Set()
  void watcher?.close()
  watcher = null
}

export function isWatching(): boolean {
  return watcher !== null
}
