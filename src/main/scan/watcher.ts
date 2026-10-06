import { extname } from 'node:path'
import chokidar, { type FSWatcher } from 'chokidar'
import { EXTENSION_FORMATS } from '@shared/types'

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
let generation = 0
let flushing = false

export interface WatcherCallbacks {
  onChanged(paths: string[]): void | Promise<void>
}

function isAudio(path: string): boolean {
  return Boolean(EXTENSION_FORMATS[extname(path).slice(1).toLowerCase()])
}

function scheduleFlush(cb: WatcherCallbacks): void {
  if (flushTimer) clearTimeout(flushTimer)
  const token = generation
  flushTimer = setTimeout(async () => {
    flushTimer = null
    if (flushing) return // pending paths stay collected until the current job finishes
    flushing = true
    try {
      const added = [...pendingAdds]
      const removed = [...pendingRemovals]
      pendingAdds = new Set()
      pendingRemovals = new Set()

      // Deletions join the same scan queue as additions. Existence is checked
      // when that job begins, so restoration while waiting wins over an old unlink.
      const paths = [...added, ...removed]
      if (paths.length) await cb.onChanged(paths)
    } catch (err) {
      console.warn('[watch] update failed', err)
    } finally {
      if (token === generation) {
        flushing = false
        if (pendingAdds.size || pendingRemovals.size) scheduleFlush(cb)
      }
    }
  }, FLUSH_DEBOUNCE_MS)
}

export function startWatching(folders: string[], cb: WatcherCallbacks): void {
  if (watcher) { watcher.add(folders); return }
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
    pendingRemovals.delete(path)
    scheduleFlush(cb)
  })

  watcher.on('unlink', (path: string) => {
    if (!isAudio(path)) return
    pendingRemovals.add(path)
    pendingAdds.delete(path)
    scheduleFlush(cb)
  })

  watcher.on('change', (path: string) => {
    // A re-tagged file needs reparsing; the scanner's mtime check makes this
    // cheap when nothing actually changed.
    if (!isAudio(path)) return
    pendingAdds.add(path)
    pendingRemovals.delete(path)
    scheduleFlush(cb)
  })

  watcher.on('error', () => {
    /* a vanished folder must not crash the app */
  })
}

export function stopWatching(): void {
  generation++
  flushing = false
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
