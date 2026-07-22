import { readdir, stat } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { parentPort, workerData } from 'node:worker_threads'
import { parseFile } from 'music-metadata'
import { EXTENSION_FORMATS } from '@shared/types'
import { storeArtwork } from './art'
import { inferFromFilename } from './infer'

/**
 * Scan worker.
 *
 * Runs off the main thread because metadata parsing is CPU-bound: doing it on
 * main would block window painting, IPC, and the tray for the duration of a
 * large scan — the UI would simply freeze. Main stays responsible only for
 * batched database writes.
 *
 * Artwork is written to the cache here rather than posted back, so multi-megabyte
 * image buffers never cross the thread boundary.
 */

export interface ScanWorkerData {
  roots: string[]
  artDir: string
  /** path -> mtimeMs of tracks already in the library, for incremental rescans. */
  known: Record<string, number>
  batchSize: number
}

export interface ParsedTrack {
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
  /** Which fields were guessed from the filename rather than read from tags. */
  titleInferred: boolean
  albumInferred: boolean
  artistInferred: boolean
  genreInferred: boolean
}

export type WorkerMessage =
  | { type: 'found'; count: number }
  | { type: 'progress'; processed: number; currentFile: string; format: string }
  | { type: 'batch'; tracks: ParsedTrack[] }
  | { type: 'skipped'; count: number }
  | { type: 'error'; path: string; message: string }
  | { type: 'done'; processed: number }

const data = workerData as ScanWorkerData
const port = parentPort

function post(msg: WorkerMessage): void {
  port?.postMessage(msg)
}

/** Directories that never contain user music and cost real time to walk. */
const SKIP_DIRS = new Set([
  'node_modules',
  '$recycle.bin',
  'system volume information',
  '.git'
])

async function walk(root: string, out: string[]): Promise<void> {
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    // Permission denied or the folder vanished mid-scan. A single unreadable
    // directory must not abort the whole library scan.
    return
  }

  for (const entry of entries) {
    const full = join(root, entry.name)
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name.toLowerCase())) continue
      await walk(full, out)
    } else if (entry.isFile()) {
      const ext = extname(entry.name).slice(1).toLowerCase()
      if (EXTENSION_FORMATS[ext]) out.push(full)
    }
  }
}

function firstString(value: unknown): string {
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : ''
  return typeof value === 'string' ? value : ''
}

/** Falls back to the filename when a file has no usable title tag. */
function titleFrom(tagTitle: string | undefined, path: string): string {
  const t = (tagTitle ?? '').trim()
  if (t) return t
  const base = path.split(/[\\/]/).pop() ?? path
  return base.replace(/\.[^.]+$/, '')
}

async function run(): Promise<void> {
  const files: string[] = []
  for (const root of data.roots) {
    try {
      const info = await stat(root)
      if (info.isDirectory()) await walk(root, files)
      else if (info.isFile()) files.push(root)
    } catch {
      /* root no longer exists */
    }
  }

  post({ type: 'found', count: files.length })

  let processed = 0
  let skipped = 0
  let batch: ParsedTrack[] = []

  for (const path of files) {
    let size = 0
    let mtime = 0
    try {
      const info = await stat(path)
      size = info.size
      mtime = Math.floor(info.mtimeMs)
    } catch {
      post({ type: 'error', path, message: 'stat failed' })
      continue
    }

    // Unchanged since the last scan — skip the expensive parse entirely. This is
    // what makes a rescan of a large library fast rather than a full reparse.
    const knownMtime = data.known[path]
    if (knownMtime !== undefined && knownMtime === mtime) {
      skipped++
      processed++
      continue
    }

    const ext = extname(path).slice(1).toLowerCase()
    const format = EXTENSION_FORMATS[ext] ?? ''

    try {
      const meta = await parseFile(path, { duration: true })
      const c = meta.common
      const f = meta.format

      let artRef: string | null = null
      const picture = c.picture?.[0]
      if (picture?.data?.length) {
        const stored = storeArtwork(data.artDir, picture.data, picture.format)
        artRef = stored?.ref ?? null
      }

      // Real tags always win; inference only fills fields the file left empty.
      const tagTitle = (c.title ?? '').trim()
      const tagArtist = (c.artist ?? '').trim()
      const tagAlbum = (c.album ?? '').trim()
      const tagGenre = firstString(c.genre).trim()

      const needsInference = !tagTitle || !tagArtist || !tagAlbum || !tagGenre
      const guess = needsInference
        ? inferFromFilename(path)
        : { title: '', album: '', artist: '', genre: '' }

      const title = tagTitle || guess.title || titleFrom(undefined, path)
      const artist = tagArtist || guess.artist
      const album = tagAlbum || guess.album
      const genre = tagGenre || guess.genre

      batch.push({
        path,
        title,
        artist,
        album,
        // Album artist drives album grouping for compilations; falling back to
        // the track artist keeps a single-artist album from splitting in two.
        albumArtist: (c.albumartist ?? '').trim() || artist,
        genre,
        titleInferred: !tagTitle,
        albumInferred: !tagAlbum && !!album,
        artistInferred: !tagArtist && !!artist,
        genreInferred: !tagGenre && !!genre,
        year: typeof c.year === 'number' ? c.year : null,
        trackNo: c.track?.no ?? null,
        discNo: c.disk?.no ?? null,
        duration: f.duration ?? 0,
        bitrate: f.bitrate ? Math.round(f.bitrate) : null,
        sampleRate: f.sampleRate ?? null,
        codec: f.codec ?? f.container ?? null,
        format,
        size,
        mtime,
        artRef
      })

      post({ type: 'progress', processed: processed + 1, currentFile: path, format })
    } catch (err) {
      post({
        type: 'error',
        path,
        message: err instanceof Error ? err.message : String(err)
      })
    }

    processed++

    if (batch.length >= data.batchSize) {
      post({ type: 'batch', tracks: batch })
      batch = []
    }
  }

  if (batch.length) post({ type: 'batch', tracks: batch })
  if (skipped) post({ type: 'skipped', count: skipped })
  post({ type: 'done', processed })
}

void run().catch((err) => {
  post({ type: 'error', path: '', message: err instanceof Error ? err.message : String(err) })
  post({ type: 'done', processed: 0 })
})
