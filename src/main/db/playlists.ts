import type { Track } from '@shared/types'
import type { Db } from './index'
import { rowToTrack } from './tracks'

/**
 * Playlist storage.
 *
 * Membership is an explicit ordered list (`playlist_tracks.position`) rather
 * than an implicit insertion order, because drag-to-reorder must persist. The
 * primary key is (playlist_id, position), so positions are rewritten as a block
 * inside one transaction — a partial reorder would violate the key and is
 * exactly the kind of thing that corrupts a playlist halfway through a drag.
 */

export interface PlaylistSummary {
  id: number
  name: string
  createdAt: number
  updatedAt: number
  trackCount: number
  duration: number
}

export function listPlaylists(db: Db): PlaylistSummary[] {
  return db
    .all<{
      id: number
      name: string
      created_at: number
      updated_at: number
      track_count: number
      duration: number
    }>(
      `SELECT p.id, p.name, p.created_at, p.updated_at,
              count(pt.track_id) AS track_count,
              coalesce(sum(t.duration), 0) AS duration
       FROM playlists p
       LEFT JOIN playlist_tracks pt ON pt.playlist_id = p.id
       LEFT JOIN tracks t ON t.id = pt.track_id
       GROUP BY p.id
       ORDER BY p.name COLLATE NOCASE`
    )
    .map((r) => ({
      id: r.id,
      name: r.name,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      trackCount: r.track_count,
      duration: r.duration
    }))
}

export function createPlaylist(db: Db, name: string, now = Date.now()): number {
  const clean = name.trim() || 'Untitled playlist'
  return db.run('INSERT INTO playlists (name, created_at, updated_at) VALUES (?, ?, ?)', [
    clean,
    now,
    now
  ]).lastInsertRowid
}

export function renamePlaylist(db: Db, id: number, name: string, now = Date.now()): void {
  db.run('UPDATE playlists SET name = ?, updated_at = ? WHERE id = ?', [
    name.trim() || 'Untitled playlist',
    now,
    id
  ])
}

export function deletePlaylist(db: Db, id: number): void {
  // playlist_tracks cascades via the foreign key.
  db.run('DELETE FROM playlists WHERE id = ?', [id])
}

export function getPlaylistTracks(db: Db, playlistId: number): Track[] {
  return db
    .all<Record<string, unknown>>(
      `SELECT t.* FROM playlist_tracks pt
       JOIN tracks t ON t.id = pt.track_id
       WHERE pt.playlist_id = ?
       ORDER BY pt.position`,
      [playlistId]
    )
    .map((r) => rowToTrack(r as never))
}

function nextPosition(db: Db, playlistId: number): number {
  const row = db.get<{ p: number | null }>(
    'SELECT max(position) AS p FROM playlist_tracks WHERE playlist_id = ?',
    [playlistId]
  )
  return (row?.p ?? -1) + 1
}

export function addTracksToPlaylist(
  db: Db,
  playlistId: number,
  trackIds: number[],
  now = Date.now()
): number {
  if (trackIds.length === 0) return 0
  let added = 0

  db.transaction(() => {
    let position = nextPosition(db, playlistId)
    for (const trackId of trackIds) {
      // A track may legitimately appear twice in a playlist, so no uniqueness
      // check here — only that the track still exists.
      const exists = db.get<{ id: number }>('SELECT id FROM tracks WHERE id = ?', [trackId])
      if (!exists) continue
      db.run(
        'INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)',
        [playlistId, trackId, position++]
      )
      added++
    }
    db.run('UPDATE playlists SET updated_at = ? WHERE id = ?', [now, playlistId])
  })

  return added
}

export function removeFromPlaylist(db: Db, playlistId: number, position: number): void {
  db.transaction(() => {
    db.run('DELETE FROM playlist_tracks WHERE playlist_id = ? AND position = ?', [
      playlistId,
      position
    ])
    compactPositions(db, playlistId)
    db.run('UPDATE playlists SET updated_at = ? WHERE id = ?', [Date.now(), playlistId])
  })
}

/**
 * Moves an entry. Positions are rewritten wholesale rather than shifted
 * individually: (playlist_id, position) is the primary key, so any incremental
 * shuffle collides with itself partway through.
 */
export function reorderPlaylist(db: Db, playlistId: number, from: number, to: number): void {
  db.transaction(() => {
    const ids = db
      .all<{ track_id: number }>(
        'SELECT track_id FROM playlist_tracks WHERE playlist_id = ? ORDER BY position',
        [playlistId]
      )
      .map((r) => r.track_id)

    if (from < 0 || from >= ids.length || to < 0 || to >= ids.length) return

    const [moved] = ids.splice(from, 1)
    ids.splice(to, 0, moved!)

    db.run('DELETE FROM playlist_tracks WHERE playlist_id = ?', [playlistId])
    ids.forEach((trackId, position) => {
      db.run('INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)', [
        playlistId,
        trackId,
        position
      ])
    })
    db.run('UPDATE playlists SET updated_at = ? WHERE id = ?', [Date.now(), playlistId])
  })
}

/** Closes gaps left by a removal so positions stay 0..n-1. */
function compactPositions(db: Db, playlistId: number): void {
  const ids = db
    .all<{ track_id: number }>(
      'SELECT track_id FROM playlist_tracks WHERE playlist_id = ? ORDER BY position',
      [playlistId]
    )
    .map((r) => r.track_id)

  db.run('DELETE FROM playlist_tracks WHERE playlist_id = ?', [playlistId])
  ids.forEach((trackId, position) => {
    db.run('INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)', [
      playlistId,
      trackId,
      position
    ])
  })
}

/**
 * Resolves a filesystem path to a track id.
 *
 * Imported playlists routinely reference files by a path that differs in case or
 * separator from the scanned one, so an exact match is tried first and a
 * normalized comparison second. Falling back to filename alone is deliberately
 * NOT done: two different albums can hold a "01 Intro.mp3".
 */
export function findTrackByPath(db: Db, path: string): number | null {
  const exact = db.get<{ id: number }>('SELECT id FROM tracks WHERE path = ?', [path])
  if (exact) return exact.id

  const normalized = path.replace(/\//g, '\\').toLowerCase()
  const row = db.get<{ id: number }>(
    'SELECT id FROM tracks WHERE lower(replace(path, "/", "\\")) = ?',
    [normalized]
  )
  return row?.id ?? null
}
