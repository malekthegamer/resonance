import type { Track } from '@shared/types'
import { canonicalizeAlbums } from '../scan/infer'
import type { Db } from './index'

/** Row shape as stored; snake_case straight from SQLite. */
interface TrackRow {
  id: number
  path: string
  title: string
  artist: string
  album: string
  album_artist: string
  genre: string
  year: number | null
  track_no: number | null
  disc_no: number | null
  duration: number
  bitrate: number | null
  sample_rate: number | null
  codec: string | null
  format: string
  size: number
  mtime: number
  art_ref: string | null
  date_added: number
  play_count: number
  last_played: number | null
  available: number
}

export function rowToTrack(r: TrackRow): Track {
  return {
    id: r.id,
    path: r.path,
    title: r.title,
    artist: r.artist,
    album: r.album,
    albumArtist: r.album_artist,
    genre: r.genre,
    year: r.year,
    trackNo: r.track_no,
    discNo: r.disc_no,
    duration: r.duration,
    bitrate: r.bitrate,
    sampleRate: r.sample_rate,
    codec: r.codec,
    format: r.format,
    size: r.size,
    mtime: r.mtime,
    artRef: r.art_ref,
    dateAdded: r.date_added,
    playCount: r.play_count,
    lastPlayed: r.last_played,
    available: r.available === 1
  }
}

export interface UpsertInput {
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
  titleInferred?: boolean
  albumInferred?: boolean
  artistInferred?: boolean
  genreInferred?: boolean
}

const UPSERT_SQL = `
INSERT INTO tracks (path, title, artist, album, album_artist, genre, year,
                    track_no, disc_no, duration, bitrate, sample_rate, codec,
                    format, size, mtime, art_ref, date_added, available,
                    title_inferred, album_inferred, artist_inferred, genre_inferred)
VALUES (:path, :title, :artist, :album, :album_artist, :genre, :year,
        :track_no, :disc_no, :duration, :bitrate, :sample_rate, :codec,
        :format, :size, :mtime, :art_ref, :date_added, 1,
        :title_inferred, :album_inferred, :artist_inferred, :genre_inferred)
ON CONFLICT(path) DO UPDATE SET
  title_inferred = excluded.title_inferred,
  album_inferred = excluded.album_inferred,
  artist_inferred = excluded.artist_inferred,
  genre_inferred = excluded.genre_inferred,
  title = excluded.title,
  artist = excluded.artist,
  album = excluded.album,
  album_artist = excluded.album_artist,
  genre = excluded.genre,
  year = excluded.year,
  track_no = excluded.track_no,
  disc_no = excluded.disc_no,
  duration = excluded.duration,
  bitrate = excluded.bitrate,
  sample_rate = excluded.sample_rate,
  codec = excluded.codec,
  format = excluded.format,
  size = excluded.size,
  mtime = excluded.mtime,
  art_ref = excluded.art_ref,
  available = 1`
// date_added, play_count and last_played are deliberately NOT updated: a rescan
// must not reset a user's listening history or reorder "Recently Added".

export interface UpsertResult {
  inserted: number
  updated: number
}

/** Writes a batch inside one transaction. Batching is what makes scans fast. */
export function upsertTracks(db: Db, tracks: UpsertInput[], now = Date.now()): UpsertResult {
  let inserted = 0
  let updated = 0

  db.transaction(() => {
    for (const t of tracks) {
      const existing = db.get<{ id: number }>('SELECT id FROM tracks WHERE path = ?', [t.path])
      db.run(UPSERT_SQL, {
        path: t.path,
        title: t.title,
        artist: t.artist,
        album: t.album,
        album_artist: t.albumArtist,
        genre: t.genre,
        year: t.year,
        track_no: t.trackNo,
        disc_no: t.discNo,
        duration: t.duration,
        bitrate: t.bitrate,
        sample_rate: t.sampleRate,
        codec: t.codec,
        format: t.format,
        size: t.size,
        mtime: t.mtime,
        art_ref: t.artRef,
        date_added: now,
        title_inferred: t.titleInferred ? 1 : 0,
        album_inferred: t.albumInferred ? 1 : 0,
        artist_inferred: t.artistInferred ? 1 : 0,
        genre_inferred: t.genreInferred ? 1 : 0
      })
      if (existing) updated++
      else inserted++
    }
  })

  return { inserted, updated }
}

export function getKnownMtimes(db: Db): Record<string, number> {
  const out: Record<string, number> = {}
  for (const r of db.all<{ path: string; mtime: number }>('SELECT path, mtime FROM tracks')) {
    out[r.path] = r.mtime
  }
  return out
}

export function countTracks(db: Db): number {
  return db.get<{ c: number }>('SELECT count(*) AS c FROM tracks')?.c ?? 0
}

export function countsByFormat(db: Db): Record<string, number> {
  const out: Record<string, number> = {}
  for (const r of db.all<{ format: string; n: number }>(
    'SELECT format, count(*) AS n FROM tracks GROUP BY format ORDER BY format'
  )) {
    out[r.format || 'unknown'] = r.n
  }
  return out
}

export function getAllTracks(db: Db, limit = 100_000): Track[] {
  return db
    .all<TrackRow>(
      'SELECT * FROM tracks ORDER BY artist COLLATE NOCASE, album COLLATE NOCASE, disc_no, track_no, title LIMIT ?',
      [limit]
    )
    .map(rowToTrack)
}

export function getTrackById(db: Db, id: number): Track | null {
  const row = db.get<TrackRow>('SELECT * FROM tracks WHERE id = ?', [id])
  return row ? rowToTrack(row) : null
}

/**
 * Full-text search. The user's raw input is turned into a prefix query so that
 * typing incrementally narrows results; FTS5 syntax characters are stripped
 * because a stray quote or asterisk would otherwise throw a syntax error mid-keystroke.
 */
export function searchTracks(db: Db, query: string, limit = 500): Track[] {
  const cleaned = query
    .replace(/["*^:(){}[\]~-]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (cleaned.length === 0) return []

  const match = cleaned.map((term) => `"${term}"*`).join(' AND ')
  return db
    .all<TrackRow>(
      `SELECT t.* FROM tracks_fts f
       JOIN tracks t ON t.id = f.rowid
       WHERE tracks_fts MATCH ?
       ORDER BY rank
       LIMIT ?`,
      [match, limit]
    )
    .map(rowToTrack)
}

/**
 * Collapses inferred album-name variants into one canonical name per series.
 *
 * Runs after a scan, over the whole library at once, because deciding that
 * "ReZero" and "Re ZERO - Starting Life in Another World" are the same album
 * needs a global view that a per-file parser cannot have.
 *
 * Restricted to album_inferred = 1. Real album tags are never rewritten.
 */
export function canonicalizeInferredAlbums(db: Db): number {
  const rows = db.all<{ album: string }>(
    "SELECT DISTINCT album FROM tracks WHERE album_inferred = 1 AND album <> ''"
  )
  if (rows.length === 0) return 0

  const mapping = canonicalizeAlbums(rows.map((r) => r.album))
  let changed = 0

  db.transaction(() => {
    for (const [original, canonical] of mapping) {
      if (original === canonical) continue
      changed += db.run('UPDATE tracks SET album = ? WHERE album = ? AND album_inferred = 1', [
        canonical,
        original
      ]).changes
    }

    // An inferred "artist" that is really the series name is noise — it comes
    // from filenames like "Re Zero - Ending 2" where the left side is the show,
    // not a performer. Left in place it pollutes the Artists view and, because
    // albums are keyed by album + album artist, splits one album into several.
    db.run(`
      UPDATE tracks SET artist = '', artist_inferred = 0
      WHERE artist_inferred = 1
        AND album_inferred = 1
        AND lower(replace(replace(artist, ' ', ''), '-', '')) =
            lower(replace(replace(album,  ' ', ''), '-', ''))
    `)

    // Give every inferred album one stable album artist. Without this, tracks
    // that happened to yield a performer ("… by Snow Man") group separately from
    // their album-mates, so one album renders as two tiles. "Various Artists" is
    // the conventional label for exactly this case — a per-series collection of
    // openings and endings by different performers — and per-track artists are
    // still shown on each row.
    db.run(
      "UPDATE tracks SET album_artist = 'Various Artists' WHERE album_inferred = 1 AND album <> ''"
    )
  })

  return changed
}

/** Marks tracks whose files no longer exist, rather than deleting them. */
export function markUnavailable(db: Db, paths: string[]): number {
  if (paths.length === 0) return 0
  let changed = 0
  db.transaction(() => {
    for (const p of paths) {
      changed += db.run('UPDATE tracks SET available = 0 WHERE path = ?', [p]).changes
    }
  })
  return changed
}
