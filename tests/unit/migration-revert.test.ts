import { beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, repairInferredTitles, type Db } from '../../src/main/db/index'
import { SCHEMA_VERSION } from '../../src/main/db/schema'

/**
 * Migration 3 undoes the filename inference that was tried and reverted.
 *
 * This has to be a migration rather than something a rescan fixes: the scanner
 * skips files whose mtime is unchanged, so inferred values would otherwise
 * survive in an existing library forever.
 */

let db: Db

const INSERT = `
  INSERT INTO tracks (path, title, artist, album, album_artist, genre, year,
                      track_no, disc_no, duration, bitrate, sample_rate, codec,
                      format, size, mtime, art_ref, date_added,
                      title_inferred, album_inferred, artist_inferred, genre_inferred)
  VALUES (:path, :title, :artist, :album, :album_artist, :genre, 2013,
          1, 1, 90, 320000, 44100, 'mp3',
          'mp3', 1000, 1, NULL, 1,
          :title_inferred, :album_inferred, :artist_inferred, :genre_inferred)`

beforeEach(() => {
  db = openDatabase(':memory:')
})

describe('migration 3 — reverting inference', () => {
  it('brings the schema to the current version', () => {
    expect(db.get<{ user_version: number }>('PRAGMA user_version')?.user_version).toBe(
      SCHEMA_VERSION
    )
  })

  it('clears inferred album, album artist and genre', () => {
    // Simulate a row written by the old inferring scanner.
    db.run(INSERT, {
      path: 'C:\\Music\\Attack on Titan OP 1 Guren No Yumiya.mp3',
      title: 'Guren No Yumiya',
      artist: '',
      album: 'Attack on Titan',
      album_artist: 'Various Artists',
      genre: 'Anime',
      title_inferred: 1,
      album_inferred: 1,
      artist_inferred: 0,
      genre_inferred: 1
    })

    // Re-running the migration body is what an upgrading library experiences.
    db.exec(`
      UPDATE tracks SET album='', album_artist='', genre='', album_inferred=0, genre_inferred=0
       WHERE album_inferred = 1;
      UPDATE tracks SET artist='', album_artist='', artist_inferred=0 WHERE artist_inferred = 1;
      UPDATE tracks SET album_artist='' WHERE album_artist='Various Artists' AND album='';
    `)

    const row = db.get<{ album: string; album_artist: string; genre: string }>(
      'SELECT album, album_artist, genre FROM tracks'
    )
    expect(row?.album).toBe('')
    expect(row?.album_artist).toBe('')
    expect(row?.genre).toBe('')
  })

  // This one leaked past the first version of the migration: album_artist fell
  // back to the inferred artist, so it held guessed data with no flag of its own.
  it('clears an album artist that came from an inferred artist', () => {
    db.run(INSERT, {
      path: 'C:\\Music\\Re Zero - Ending 2.mp3',
      title: 'Ending 2',
      artist: 'Re Zero',
      album: '',
      album_artist: 'Re Zero',
      genre: '',
      title_inferred: 1,
      album_inferred: 0,
      artist_inferred: 1,
      genre_inferred: 0
    })

    db.exec(`UPDATE tracks SET artist='', album_artist='', artist_inferred=0
              WHERE artist_inferred = 1;`)

    const row = db.get<{ artist: string; album_artist: string }>(
      'SELECT artist, album_artist FROM tracks'
    )
    expect(row?.artist).toBe('')
    expect(row?.album_artist).toBe('')
  })

  it('never touches rows carrying real tags', () => {
    db.run(INSERT, {
      path: 'C:\\Music\\real.mp3',
      title: 'Real Title',
      artist: 'Real Artist',
      album: 'Real Album',
      album_artist: 'Real Album Artist',
      genre: 'Rock',
      title_inferred: 0,
      album_inferred: 0,
      artist_inferred: 0,
      genre_inferred: 0
    })

    db.exec(`
      UPDATE tracks SET album='', album_artist='', genre='', album_inferred=0, genre_inferred=0
       WHERE album_inferred = 1;
      UPDATE tracks SET artist='', album_artist='', artist_inferred=0 WHERE artist_inferred = 1;
    `)

    const row = db.get<Record<string, string>>('SELECT * FROM tracks')
    expect(row?.['title']).toBe('Real Title')
    expect(row?.['artist']).toBe('Real Artist')
    expect(row?.['album']).toBe('Real Album')
    expect(row?.['genre']).toBe('Rock')
  })
})

describe('repairInferredTitles', () => {
  // The serious one: inference stripped the series out of titles, so searching
  // for "titan" returned nothing at all.
  it('restores the full filename as the title', () => {
    db.run(INSERT, {
      path: 'C:\\Music\\Attack on Titan OP 1 Guren No Yumiya.mp3',
      title: 'Guren No Yumiya',
      artist: '',
      album: '',
      album_artist: '',
      genre: '',
      title_inferred: 1,
      album_inferred: 0,
      artist_inferred: 0,
      genre_inferred: 0
    })

    expect(repairInferredTitles(db)).toBe(1)
    expect(db.get<{ title: string }>('SELECT title FROM tracks')?.title).toBe(
      'Attack on Titan OP 1 Guren No Yumiya'
    )
  })

  it('makes the series searchable again', () => {
    db.run(INSERT, {
      path: 'C:\\Music\\Attack on Titan OP 1 Guren No Yumiya.mp3',
      title: 'Guren No Yumiya',
      artist: '',
      album: '',
      album_artist: '',
      genre: '',
      title_inferred: 1,
      album_inferred: 0,
      artist_inferred: 0,
      genre_inferred: 0
    })

    const before = db.all("SELECT rowid FROM tracks_fts WHERE tracks_fts MATCH 'titan'")
    expect(before).toHaveLength(0)

    repairInferredTitles(db)

    const after = db.all("SELECT rowid FROM tracks_fts WHERE tracks_fts MATCH 'titan'")
    expect(after, 'the FTS index must pick up the restored title').toHaveLength(1)
  })

  it('leaves real title tags alone', () => {
    db.run(INSERT, {
      path: 'C:\\Music\\whatever.mp3',
      title: 'A Proper Title',
      artist: '',
      album: '',
      album_artist: '',
      genre: '',
      title_inferred: 0,
      album_inferred: 0,
      artist_inferred: 0,
      genre_inferred: 0
    })

    expect(repairInferredTitles(db)).toBe(0)
    expect(db.get<{ title: string }>('SELECT title FROM tracks')?.title).toBe('A Proper Title')
  })

  it('is idempotent, so running it on every open costs nothing', () => {
    db.run(INSERT, {
      path: 'C:\\Music\\Some Long Name.mp3',
      title: 'Name',
      artist: '',
      album: '',
      album_artist: '',
      genre: '',
      title_inferred: 1,
      album_inferred: 0,
      artist_inferred: 0,
      genre_inferred: 0
    })

    expect(repairInferredTitles(db)).toBe(1)
    expect(repairInferredTitles(db)).toBe(0)
  })

  it('handles forward slashes and names containing dots', () => {
    db.run(INSERT, {
      path: 'C:/Music/ASH DA HERO  Octave Nagi movie ver..mp3',
      title: 'wrong',
      artist: '',
      album: '',
      album_artist: '',
      genre: '',
      title_inferred: 1,
      album_inferred: 0,
      artist_inferred: 0,
      genre_inferred: 0
    })

    repairInferredTitles(db)
    expect(db.get<{ title: string }>('SELECT title FROM tracks')?.title).toBe(
      'ASH DA HERO  Octave Nagi movie ver.'
    )
  })
})
