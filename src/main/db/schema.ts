/**
 * Schema and migrations for the Resonance library database.
 *
 * Design note — albums and artists are NOT normalized into their own tables.
 * They are derived with GROUP BY over indexed columns on `tracks`. The library
 * is read-mostly and rescanned wholesale; normalized tables would need to be
 * reconciled on every rescan, and stale orphan rows after a re-tag are a classic
 * source of "ghost albums" that never go away. A GROUP BY over an indexed column
 * is fast enough at library scale, and it cannot drift out of sync with reality.
 */

export const SCHEMA_VERSION = 3

/**
 * Each migration is applied in order and recorded. Index 0 creates the initial
 * schema; later entries append. Never edit a shipped migration — add a new one.
 */
export const MIGRATIONS: readonly string[] = [
  /* --- 1: initial schema --- */ `
  CREATE TABLE IF NOT EXISTS tracks (
    id            INTEGER PRIMARY KEY,
    path          TEXT    NOT NULL UNIQUE,
    title         TEXT    NOT NULL,
    artist        TEXT    NOT NULL DEFAULT '',
    album         TEXT    NOT NULL DEFAULT '',
    album_artist  TEXT    NOT NULL DEFAULT '',
    genre         TEXT    NOT NULL DEFAULT '',
    year          INTEGER,
    track_no      INTEGER,
    disc_no       INTEGER,
    duration      REAL    NOT NULL DEFAULT 0,
    bitrate       INTEGER,
    sample_rate   INTEGER,
    codec         TEXT,
    -- Normalized container ('mp3' | 'flac' | 'wav' | 'm4a' | 'ogg' | 'opus' | 'wma').
    -- Kept as a column so per-format coverage can be reported from the DB
    -- rather than inferred from file extensions (plan §A3).
    format        TEXT    NOT NULL DEFAULT '',
    size          INTEGER NOT NULL DEFAULT 0,
    mtime         INTEGER NOT NULL DEFAULT 0,
    -- Content hash of the embedded artwork; the key into the on-disk art cache.
    art_ref       TEXT,
    date_added    INTEGER NOT NULL,
    play_count    INTEGER NOT NULL DEFAULT 0,
    last_played   INTEGER,
    -- 0 when the file has moved or been deleted. Rows are kept rather than
    -- removed so playlists and play counts survive a temporarily missing drive.
    available     INTEGER NOT NULL DEFAULT 1
  );

  CREATE INDEX IF NOT EXISTS idx_tracks_artist      ON tracks (artist);
  CREATE INDEX IF NOT EXISTS idx_tracks_album       ON tracks (album);
  CREATE INDEX IF NOT EXISTS idx_tracks_album_artist ON tracks (album_artist);
  CREATE INDEX IF NOT EXISTS idx_tracks_genre       ON tracks (genre);
  CREATE INDEX IF NOT EXISTS idx_tracks_date_added  ON tracks (date_added DESC);
  CREATE INDEX IF NOT EXISTS idx_tracks_play_count  ON tracks (play_count DESC);
  CREATE INDEX IF NOT EXISTS idx_tracks_available   ON tracks (available);

  CREATE TABLE IF NOT EXISTS playlists (
    id         INTEGER PRIMARY KEY,
    name       TEXT    NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS playlist_tracks (
    playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    track_id    INTEGER NOT NULL REFERENCES tracks(id)    ON DELETE CASCADE,
    position    INTEGER NOT NULL,
    PRIMARY KEY (playlist_id, position)
  );

  CREATE INDEX IF NOT EXISTS idx_playlist_tracks_track ON playlist_tracks (track_id);

  CREATE TABLE IF NOT EXISTS watched_folders (
    id       INTEGER PRIMARY KEY,
    path     TEXT    NOT NULL UNIQUE,
    added_at INTEGER NOT NULL
  );

  -- Full-text search over the fields the global search box covers. Uses an
  -- external-content table so the text is not stored twice; triggers below keep
  -- it in lockstep with the tracks table.
  CREATE VIRTUAL TABLE IF NOT EXISTS tracks_fts USING fts5(
    title, artist, album,
    content='tracks',
    content_rowid='id',
    tokenize='unicode61 remove_diacritics 2'
  );

  CREATE TRIGGER IF NOT EXISTS tracks_fts_ai AFTER INSERT ON tracks BEGIN
    INSERT INTO tracks_fts(rowid, title, artist, album)
    VALUES (new.id, new.title, new.artist, new.album);
  END;

  CREATE TRIGGER IF NOT EXISTS tracks_fts_ad AFTER DELETE ON tracks BEGIN
    INSERT INTO tracks_fts(tracks_fts, rowid, title, artist, album)
    VALUES ('delete', old.id, old.title, old.artist, old.album);
  END;

  CREATE TRIGGER IF NOT EXISTS tracks_fts_au AFTER UPDATE ON tracks BEGIN
    INSERT INTO tracks_fts(tracks_fts, rowid, title, artist, album)
    VALUES ('delete', old.id, old.title, old.artist, old.album);
    INSERT INTO tracks_fts(rowid, title, artist, album)
    VALUES (new.id, new.title, new.artist, new.album);
  END;
  `,

  /* --- 2: mark which fields came from filename inference --- */ `
  -- Tracks whose album name was guessed from the filename rather than read from
  -- a tag. Only these are eligible for canonicalization: two genuinely distinct
  -- tagged albums may legitimately share a name prefix, and rewriting a real
  -- tag would be destroying user data.
  ALTER TABLE tracks ADD COLUMN album_inferred INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE tracks ADD COLUMN artist_inferred INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE tracks ADD COLUMN title_inferred INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE tracks ADD COLUMN genre_inferred INTEGER NOT NULL DEFAULT 0;
  `,

  /* --- 3: undo filename inference --- */ `
  -- Filename inference was tried and reverted. It produced plausible-looking but
  -- unverifiable groupings, and an untagged library is better served by explicit
  -- playlists than by the app inventing structure.
  --
  -- This has to be a migration rather than something a rescan fixes: the scanner
  -- skips files whose mtime is unchanged, so inferred values would otherwise
  -- survive in an existing library indefinitely.
  --
  -- Only ever touches rows the app itself guessed. Real tags are untouched.
  UPDATE tracks
     SET album = '', album_artist = '', genre = '',
         album_inferred = 0, genre_inferred = 0
   WHERE album_inferred = 1;

  -- album_artist fell back to the (inferred) artist, so it carries guessed data
  -- without a flag of its own and must be cleared alongside it.
  UPDATE tracks
     SET artist = '', album_artist = '', artist_inferred = 0
   WHERE artist_inferred = 1;

  -- The album_artist fallback also wrote "Various Artists" onto inferred albums.
  UPDATE tracks
     SET album_artist = ''
   WHERE album_artist = 'Various Artists' AND album = '';
  `
]
