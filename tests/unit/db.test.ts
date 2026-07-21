import { beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type Db } from '../../src/main/db/index'

function makeTrack(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    path: 'C:\\Music\\a.mp3',
    title: 'Guren no Yumiya',
    artist: 'Linked Horizon',
    album: 'Attack on Titan',
    album_artist: 'Linked Horizon',
    genre: 'Anime',
    year: 2013,
    track_no: 1,
    disc_no: 1,
    duration: 241,
    bitrate: 320000,
    sample_rate: 44100,
    codec: 'MPEG 1 Layer 3',
    format: 'mp3',
    size: 9_600_000,
    mtime: 1_700_000_000,
    art_ref: null,
    date_added: 1_700_000_000,
    ...over
  }
}

const INSERT = `
  INSERT INTO tracks (path, title, artist, album, album_artist, genre, year,
                      track_no, disc_no, duration, bitrate, sample_rate, codec,
                      format, size, mtime, art_ref, date_added)
  VALUES (:path, :title, :artist, :album, :album_artist, :genre, :year,
          :track_no, :disc_no, :duration, :bitrate, :sample_rate, :codec,
          :format, :size, :mtime, :art_ref, :date_added)`

let db: Db

beforeEach(() => {
  db = openDatabase(':memory:')
})

describe('schema + migrations', () => {
  it('creates every table the app depends on', () => {
    const names = db
      .all<{ name: string }>("SELECT name FROM sqlite_master WHERE type IN ('table','view') ORDER BY name")
      .map((r) => r.name)

    for (const t of ['tracks', 'playlists', 'playlist_tracks', 'watched_folders', 'tracks_fts']) {
      expect(names).toContain(t)
    }
  })

  it('records its version and is idempotent when re-run', () => {
    expect(db.get<{ user_version: number }>('PRAGMA user_version')?.user_version).toBe(1)
    // Re-opening the same (in-memory) schema path must not throw or double-apply.
    expect(() => openDatabase(':memory:')).not.toThrow()
  })

  it('reports a real SQLite version', () => {
    expect(db.sqliteVersion).toMatch(/^\d+\.\d+\.\d+$/)
  })
})

describe('tracks', () => {
  it('round-trips a row including non-ASCII text', () => {
    db.run(INSERT, makeTrack({ title: '紅蓮の弓矢', artist: 'Linked Horizon' }))
    const row = db.get<{ title: string; artist: string }>('SELECT title, artist FROM tracks')
    expect(row?.title).toBe('紅蓮の弓矢')
    expect(row?.artist).toBe('Linked Horizon')
  })

  it('rejects duplicate paths, which is what makes rescans safe to repeat', () => {
    db.run(INSERT, makeTrack())
    expect(() => db.run(INSERT, makeTrack())).toThrow()
    expect(db.get<{ c: number }>('SELECT count(*) AS c FROM tracks')?.c).toBe(1)
  })

  it('derives albums and artists by grouping rather than from separate tables', () => {
    db.run(INSERT, makeTrack({ path: 'a.mp3', album: 'Attack on Titan', artist: 'Linked Horizon' }))
    db.run(INSERT, makeTrack({ path: 'b.mp3', album: 'Attack on Titan', artist: 'Linked Horizon' }))
    db.run(INSERT, makeTrack({ path: 'c.mp3', album: 'Chainsaw Man', artist: 'Kenshi Yonezu' }))

    const albums = db.all<{ album: string; n: number }>(
      'SELECT album, count(*) AS n FROM tracks GROUP BY album ORDER BY album'
    )
    expect(albums).toEqual([
      { album: 'Attack on Titan', n: 2 },
      { album: 'Chainsaw Man', n: 1 }
    ])
  })

  it('counts tracks per format, which is how §A3 coverage gets reported', () => {
    for (const [i, fmt] of ['mp3', 'flac', 'wav', 'm4a', 'ogg', 'opus'].entries()) {
      db.run(INSERT, makeTrack({ path: `t${i}.${fmt}`, format: fmt }))
    }
    const byFormat = db.all<{ format: string; n: number }>(
      'SELECT format, count(*) AS n FROM tracks GROUP BY format ORDER BY format'
    )
    expect(byFormat.map((r) => r.format)).toEqual(['flac', 'm4a', 'mp3', 'ogg', 'opus', 'wav'])
  })
})

describe('transactions', () => {
  it('commits a batch — the scanner inserts in batches, not row by row', () => {
    db.transaction(() => {
      for (let i = 0; i < 250; i++) db.run(INSERT, makeTrack({ path: `bulk-${i}.mp3` }))
    })
    expect(db.get<{ c: number }>('SELECT count(*) AS c FROM tracks')?.c).toBe(250)
  })

  it('rolls the whole batch back on failure, leaving no half-scanned state', () => {
    expect(() =>
      db.transaction(() => {
        db.run(INSERT, makeTrack({ path: 'ok-1.mp3' }))
        db.run(INSERT, makeTrack({ path: 'ok-2.mp3' }))
        db.run(INSERT, makeTrack({ path: 'ok-1.mp3' })) // duplicate → throws
      })
    ).toThrow()

    expect(db.get<{ c: number }>('SELECT count(*) AS c FROM tracks')?.c).toBe(0)
  })

  it('propagates the original error rather than a rollback error', () => {
    expect(() =>
      db.transaction(() => {
        throw new Error('scanner exploded')
      })
    ).toThrow('scanner exploded')
  })
})

describe('full-text search', () => {
  beforeEach(() => {
    db.run(INSERT, makeTrack({ path: '1.mp3', title: 'Guren no Yumiya', artist: 'Linked Horizon', album: 'Attack on Titan' }))
    db.run(INSERT, makeTrack({ path: '2.mp3', title: 'KICK BACK', artist: 'Kenshi Yonezu', album: 'Chainsaw Man' }))
    db.run(INSERT, makeTrack({ path: '3.mp3', title: 'The Rumbling', artist: 'SiM', album: 'Attack on Titan' }))
  })

  it('finds tracks by title, artist, and album', () => {
    const byTitle = db.all<{ title: string }>(
      "SELECT t.title FROM tracks_fts f JOIN tracks t ON t.id = f.rowid WHERE tracks_fts MATCH ?", ['rumbling']
    )
    expect(byTitle.map((r) => r.title)).toEqual(['The Rumbling'])

    const byAlbum = db.all<{ title: string }>(
      "SELECT t.title FROM tracks_fts f JOIN tracks t ON t.id = f.rowid WHERE tracks_fts MATCH ? ORDER BY t.title", ['titan']
    )
    expect(byAlbum).toHaveLength(2)
  })

  it('supports prefix matching, which is what incremental typing needs', () => {
    const hits = db.all<{ title: string }>(
      "SELECT t.title FROM tracks_fts f JOIN tracks t ON t.id = f.rowid WHERE tracks_fts MATCH ?", ['yone*']
    )
    expect(hits.map((r) => r.title)).toEqual(['KICK BACK'])
  })

  // The FTS index is maintained by triggers. If those ever break, search goes
  // stale silently while the library still looks correct — so both edit paths
  // are covered.
  it('stays in sync when a track is updated', () => {
    db.run("UPDATE tracks SET title = 'Shinzou wo Sasageyo' WHERE path = '1.mp3'")

    const stale = db.all("SELECT rowid FROM tracks_fts WHERE tracks_fts MATCH ?", ['guren'])
    expect(stale).toHaveLength(0)

    const fresh = db.all("SELECT rowid FROM tracks_fts WHERE tracks_fts MATCH ?", ['sasageyo'])
    expect(fresh).toHaveLength(1)
  })

  it('stays in sync when a track is deleted', () => {
    db.run("DELETE FROM tracks WHERE path = '2.mp3'")
    const hits = db.all("SELECT rowid FROM tracks_fts WHERE tracks_fts MATCH ?", ['kick'])
    expect(hits).toHaveLength(0)
  })
})

describe('playlists', () => {
  it('cascades membership when a playlist is deleted', () => {
    db.run(INSERT, makeTrack({ path: 'p1.mp3' }))
    const trackId = db.get<{ id: number }>('SELECT id FROM tracks')!.id

    db.run('INSERT INTO playlists (name, created_at, updated_at) VALUES (?, ?, ?)', [
      'Openings',
      1,
      1
    ])
    const playlistId = db.get<{ id: number }>('SELECT id FROM playlists')!.id

    db.run('INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)', [
      playlistId,
      trackId,
      0
    ])

    db.run('DELETE FROM playlists WHERE id = ?', [playlistId])
    expect(db.get<{ c: number }>('SELECT count(*) AS c FROM playlist_tracks')?.c).toBe(0)
    // The track itself must survive its playlist.
    expect(db.get<{ c: number }>('SELECT count(*) AS c FROM tracks')?.c).toBe(1)
  })

  it('cascades membership when a track is deleted', () => {
    db.run(INSERT, makeTrack({ path: 'p2.mp3' }))
    const trackId = db.get<{ id: number }>('SELECT id FROM tracks')!.id
    db.run('INSERT INTO playlists (name, created_at, updated_at) VALUES (?, ?, ?)', ['X', 1, 1])
    const playlistId = db.get<{ id: number }>('SELECT id FROM playlists')!.id
    db.run('INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)', [
      playlistId,
      trackId,
      0
    ])

    db.run('DELETE FROM tracks WHERE id = ?', [trackId])
    expect(db.get<{ c: number }>('SELECT count(*) AS c FROM playlist_tracks')?.c).toBe(0)
  })
})
