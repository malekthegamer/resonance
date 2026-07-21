import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import { app } from 'electron'
import { EMPTY_SCAN_PROGRESS, type ScanProgress } from '@shared/types'
import { getDb } from '../db/open'
import { getKnownMtimes, upsertTracks } from '../db/tracks'
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

let active: Worker | null = null

export function artCacheDir(): string {
  return join(app.getPath('userData'), 'artcache')
}

export function isScanning(): boolean {
  return active !== null
}

export interface ScanCallbacks {
  onProgress(progress: ScanProgress): void
}

export function cancelScan(): void {
  if (active) {
    void active.terminate()
    active = null
  }
}

export function scanFolders(roots: string[], cb: ScanCallbacks): Promise<ScanProgress> {
  if (active) return Promise.reject(new Error('A scan is already running'))

  const db = getDb()
  const started = Date.now()

  const progress: ScanProgress = {
    ...EMPTY_SCAN_PROGRESS,
    phase: 'walking',
    byFormat: {}
  }

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
    active = worker

    const finish = (phase: ScanProgress['phase']): void => {
      progress.phase = phase
      progress.elapsedMs = Date.now() - started
      active = null
      emit(true)
      resolve({ ...progress, byFormat: { ...progress.byFormat } })
    }

    worker.on('message', (msg: WorkerMessage) => {
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
    })

    worker.on('error', (err) => {
      active = null
      progress.phase = 'error'
      emit(true)
      reject(err)
    })

    worker.on('exit', (code) => {
      // A non-zero exit after 'done' has already resolved is harmless; only an
      // unexpected exit while still active needs reporting.
      if (active === worker) {
        active = null
        if (code === 0) finish('done')
        else finish('cancelled')
      }
    })
  })

  function writeBatch(tracks: ParsedTrack[]): { inserted: number; updated: number } {
    return upsertTracks(db, tracks)
  }
}
