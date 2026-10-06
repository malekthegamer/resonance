import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import { existsSync } from 'node:fs'
import { app } from 'electron'
import { EMPTY_SCAN_PROGRESS, type ScanProgress } from '@shared/types'
import { getDb } from '../db/open'
import { getKnownMtimes, upsertTracks, markUnavailable } from '../db/tracks'
import { libraryChanged } from '../libraryEvents'
import { SerialQueue } from './queue'
import type { ParsedTrack, ScanWorkerData, WorkerMessage } from './worker'

/**
 * Drives a scan: spawns the worker, batches its output into database
 * transactions, and streams progress to the renderer.
 *
 * Progress is throttled rather than forwarded per file — a 50,000-track scan
 * would otherwise fire 50,000 IPC messages and 50,000 React renders, which is
 * its own kind of UI freeze.
 */

const BATCH_SIZE = 50
const PROGRESS_THROTTLE_MS = 120

const queue = new SerialQueue<ScanProgress>()

export function artCacheDir(): string {
  return join(app.getPath('userData'), 'artcache')
}

export function isScanning(): boolean {
  return queue.busy
}

export interface ScanCallbacks {
  onProgress(progress: ScanProgress): void
}

export function cancelScan(): void {
  queue.cancel()
}

export function shutdownScans(): void { queue.shutdown() }

export function scanFolders(roots: string[], cb: ScanCallbacks): Promise<ScanProgress> {
  return queue.enqueue((signal) => runScan([...new Set(roots)], cb, signal))
}

function runScan(roots: string[], cb: ScanCallbacks, signal: AbortSignal): Promise<ScanProgress> {

  const db = getDb()
  const started = Date.now()

  const progress: ScanProgress = {
    ...EMPTY_SCAN_PROGRESS,
    phase: 'walking',
    byFormat: {}
  }
  if (signal.aborted) {
    progress.phase = 'cancelled'
    cb.onProgress(progress)
    return Promise.resolve(progress)
  }
  // A watcher job may have waited behind a long scan while its file vanished.
  const removed = markUnavailable(db, roots.filter((path) => !existsSync(path)))
  if (removed) libraryChanged()

  let lastEmit = 0
  const emit = (force = false): void => {
    const now = Date.now()
    if (!force && now - lastEmit < PROGRESS_THROTTLE_MS) return
    lastEmit = now
    progress.elapsedMs = now - started
    cb.onProgress({ ...progress, byFormat: { ...progress.byFormat } })
  }

  const workerData: ScanWorkerData = {
    roots,
    artDir: artCacheDir(),
    known: getKnownMtimes(db),
    batchSize: BATCH_SIZE
  }

  return new Promise<ScanProgress>((resolve, reject) => {
    // electron-vite emits the worker as its own entry beside the main bundle.
    const worker = new Worker(join(__dirname, 'scan-worker.js'), { workerData })
    let settled = false

    const finish = (phase: ScanProgress['phase'], error?: unknown): void => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', onAbort)
      progress.phase = phase
      progress.elapsedMs = Date.now() - started
      emit(true)
      // Wait for termination before the next queued job can own the database.
      void worker.terminate().then(() => {
        if (error) reject(error)
        else resolve({ ...progress, byFormat: { ...progress.byFormat } })
      }, reject)
    }
    const onAbort = (): void => finish('cancelled')
    signal.addEventListener('abort', onAbort, { once: true })

    worker.on('message', (msg: WorkerMessage) => {
      if (settled) return
      try {
        switch (msg.type) {
          case 'found':
            progress.filesFound = msg.count
            progress.phase = 'parsing'
            emit(true)
            break

          case 'progress':
            progress.filesProcessed = msg.processed
            progress.currentFile = msg.currentFile
            if (msg.format) {
              progress.byFormat[msg.format] = (progress.byFormat[msg.format] ?? 0) + 1
            }
            emit()
            break

          case 'batch': {
            const result = writeBatch(msg.tracks)
            progress.inserted += result.inserted
            progress.updated += result.updated
            if (result.inserted || result.updated) libraryChanged()
            emit()
            break
          }

          case 'skipped':
            progress.skipped += msg.count
            break

          case 'error':
            progress.errors++
            break

          case 'done':
            progress.filesProcessed = Math.max(progress.filesProcessed, msg.processed)
            finish('done')
            break
        }
      } catch (err) { finish('error', err) }
    })

    worker.on('error', (err) => {
      finish('error', err)
    })

    worker.on('exit', (code) => {
      if (!settled) finish('error', new Error(`Scanner exited before completion (${code})`))
    })
  })

  function writeBatch(tracks: ParsedTrack[]): { inserted: number; updated: number } {
    return upsertTracks(db, tracks)
  }
}
