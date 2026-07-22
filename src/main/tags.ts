import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import { File as TagFile, Picture } from 'node-taglib-sharp'
import type { Db } from './db'

/**
 * Writes real tags into the files themselves.
 *
 * `music-metadata` stays the reader — it drives the scanner and has no write
 * API. `node-taglib-sharp` does the writing. It was chosen over the
 * alternatives because its dependencies are pure JavaScript, which keeps the
 * zero-native-modules guarantee that makes packaging reliable here.
 *
 * Verified before this module existed: taglib writes and `music-metadata` reads
 * back identically across mp3, flac, m4a, ogg, opus and wav, non-ASCII
 * included. That mattered — the two libraries agreeing was the whole premise.
 *
 * Every file is copied to a backup **once, ever** before its first edit. Not
 * once per edit: the point is to preserve the original the user came in with,
 * and re-backing-up after an edit would overwrite exactly that.
 */

/**
 * Fields to change.
 *
 * `undefined` means "leave alone" — that is what makes editing twelve tracks at
 * once safe, since a field the user never touched must not be blanked across
 * the whole selection. An empty string (or 0) means "clear this field", which
 * is a thing the user can legitimately ask for.
 */
export interface TagValues {
  title?: string
  artist?: string
  album?: string
  albumArtist?: string
  genre?: string
  year?: number
  trackNo?: number
  discNo?: number
}

export interface TagReadResult {
  path: string
  ok: boolean
  error?: string
  tags?: Required<TagValues>
}

export interface TagWriteResult {
  path: string
  ok: boolean
  error?: string
  /** True when this call created the file's one-and-only backup. */
  backedUp?: boolean
}

/**
 * Where a file's backup lives, under a caller-supplied root.
 *
 * The root is passed in rather than read from `app.getPath` so this module
 * never imports `electron` — the same rule the database layer follows, and what
 * lets the destructive parts be unit tested against throwaway copies under
 * plain Node instead of only inside a running app.
 *
 * Keyed by a hash of the full path rather than the filename: two different
 * albums both containing `01 - Intro.mp3` must not collide, and a hash keeps
 * the tree flat and the name filesystem-safe.
 */
export function backupSlotFor(backupRoot: string, path: string): { dir: string; file: string } {
  const key = createHash('sha256').update(path).digest('hex').slice(0, 16)
  const dir = join(backupRoot, key)
  return { dir, file: join(dir, basename(path)) }
}

/**
 * Copies the original aside, exactly once in the file's lifetime.
 *
 * `mkdirSync` without `recursive` throws EEXIST when the directory is already
 * there, which makes creating it an atomic test-and-set: two writes racing on
 * the same file cannot both decide they are the first. An `existsSync` check
 * followed by a create would leave that gap open — and losing this race means
 * overwriting the pristine original with an already-edited copy, which is the
 * one failure this whole mechanism exists to prevent.
 */
export function backupOnce(backupRoot: string, path: string): boolean {
  const { dir, file } = backupSlotFor(backupRoot, path)
  mkdirSync(backupRoot, { recursive: true })
  try {
    mkdirSync(dir)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') return false
    throw err
  }
  copyFileSync(path, file)
  return true
}

function firstOr(values: readonly string[] | undefined, fallback = ''): string {
  return values && values.length > 0 ? (values[0] ?? fallback) : fallback
}

export function readTags(paths: readonly string[]): TagReadResult[] {
  return paths.map((path) => {
    let file: TagFile | undefined
    try {
      file = TagFile.createFromPath(path)
      const t = file.tag
      return {
        path,
        ok: true,
        tags: {
          title: t.title ?? '',
          artist: firstOr(t.performers),
          album: t.album ?? '',
          albumArtist: firstOr(t.albumArtists),
          genre: firstOr(t.genres),
          year: t.year ?? 0,
          trackNo: t.track ?? 0,
          discNo: t.disc ?? 0
        }
      }
    } catch (err) {
      return { path, ok: false, error: messageOf(err) }
    } finally {
      file?.dispose()
    }
  })
}

function messageOf(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  // Windows reports a file held open by the audio element as EBUSY/EPERM, which
  // is meaningless to a user staring at a tag dialog.
  if (/EBUSY|EPERM|being used by another process/i.test(message)) {
    return 'The file is in use. Stop playback and try again.'
  }
  return message
}

/** Applies only the fields that are actually present in `changes`. */
function applyTo(file: TagFile, changes: TagValues): void {
  const t = file.tag
  if (changes.title !== undefined) t.title = changes.title
  if (changes.artist !== undefined) t.performers = changes.artist ? [changes.artist] : []
  if (changes.album !== undefined) t.album = changes.album
  if (changes.albumArtist !== undefined) {
    t.albumArtists = changes.albumArtist ? [changes.albumArtist] : []
  }
  if (changes.genre !== undefined) t.genres = changes.genre ? [changes.genre] : []
  if (changes.year !== undefined) t.year = changes.year
  if (changes.trackNo !== undefined) t.track = changes.trackNo
  if (changes.discNo !== undefined) t.disc = changes.discNo
}

/**
 * Writes tags into each file, reporting per file.
 *
 * Failures are per-file on purpose. A batch of twelve where the third is locked
 * by the audio engine should write the other eleven and say which one did not —
 * failing the whole batch would leave the user with no idea how far it got.
 * Files already written are *not* rolled back; the backups are the undo.
 */
export interface WriteOptions {
  /** Directory the one-time originals are copied into. */
  backupRoot: string
  /** A path embeds that image; `null` clears artwork; omitted leaves it alone. */
  artworkPath?: string | null
}

export function writeTags(
  paths: readonly string[],
  changes: TagValues,
  { backupRoot, artworkPath }: WriteOptions
): TagWriteResult[] {
  return paths.map((path) => {
    let file: TagFile | undefined
    let backedUp = false
    try {
      backedUp = backupOnce(backupRoot, path)

      file = TagFile.createFromPath(path)
      applyTo(file, changes)
      // `null` clears existing artwork; `undefined` leaves it alone. Same rule
      // as the text fields.
      if (artworkPath === null) file.tag.pictures = []
      else if (artworkPath) file.tag.pictures = [Picture.fromPath(artworkPath)]
      file.save()

      return { path, ok: true, backedUp }
    } catch (err) {
      return { path, ok: false, error: messageOf(err), backedUp }
    } finally {
      file?.dispose()
    }
  })
}

/**
 * Narrows renderer-supplied paths to files the library actually knows about.
 *
 * The renderer must not be able to hand the main process an arbitrary path and
 * have it rewritten — the tag channel would otherwise be a write primitive
 * pointed at the whole filesystem. Only rows in `tracks` are eligible.
 */
export function knownPaths(db: Db, paths: readonly string[]): string[] {
  const allowed: string[] = []
  for (const path of paths) {
    const row = db.get<{ path: string }>('SELECT path FROM tracks WHERE path = ?', [path])
    if (row) allowed.push(row.path)
  }
  return allowed
}
