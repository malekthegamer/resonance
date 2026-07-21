import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Content-addressed album-art cache.
 *
 * Artwork is keyed by the SHA-256 of the image bytes, so every track on an album
 * shares one file on disk regardless of how many copies are embedded across the
 * album's tracks. That is what keeps the cache bounded: a 20-track album with
 * identical embedded covers costs one image, not twenty.
 *
 * No electron import — this runs inside the scan worker thread.
 */

const EXT_BY_MIME: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/bmp': 'bmp'
}

export function artFileName(hash: string, ext: string): string {
  // Sharded by the first two hex characters so no single directory accumulates
  // tens of thousands of entries, which Windows Explorer and readdir both hate.
  return join(hash.slice(0, 2), `${hash}.${ext}`)
}

export interface StoredArt {
  /** Cache key stored in tracks.art_ref, e.g. "ab/abcdef….jpg". */
  ref: string
  bytes: number
  deduped: boolean
}

/** Writes artwork to the cache if not already present. Returns its reference. */
export function storeArtwork(
  artDir: string,
  data: Uint8Array,
  mime: string | undefined
): StoredArt | null {
  if (!data || data.length === 0) return null

  const ext = EXT_BY_MIME[(mime ?? '').toLowerCase()] ?? 'jpg'
  const hash = createHash('sha256').update(data).digest('hex')
  const ref = artFileName(hash, ext)
  const full = join(artDir, ref)

  if (existsSync(full)) return { ref, bytes: data.length, deduped: true }

  mkdirSync(join(artDir, hash.slice(0, 2)), { recursive: true })
  writeFileSync(full, data)
  return { ref, bytes: data.length, deduped: false }
}

/**
 * Resolves a cache reference to an absolute path, refusing anything that tries
 * to escape the cache directory. The reference reaches this function from the
 * database, but the protocol handler is the app's file-serving boundary and must
 * not assume its input is well formed.
 */
export function resolveArtPath(artDir: string, ref: string): string | null {
  if (!ref || ref.includes('..') || ref.includes('\0')) return null
  if (!/^[0-9a-f]{2}[\\/][0-9a-f]{64}\.[a-z]{3,4}$/i.test(ref)) return null
  return join(artDir, ref)
}
