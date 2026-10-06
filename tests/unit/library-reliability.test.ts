import { expect, it } from 'vitest'
import { openDatabase } from '../../src/main/db'
import { getKnownMtimes, markUnavailable } from '../../src/main/db/tracks'
import { addTracksToPlaylist, createPlaylist, getPlaylistTracks, reorderPlaylist } from '../../src/main/db/playlists'

it('does not skip a restored unavailable file just because its mtime matches', () => {
  const db = openDatabase(':memory:')
  try {
    db.run('INSERT INTO tracks(path,title,date_added,mtime) VALUES(?,?,?,?)', ['restore.mp3', 'Original', 1, 42])
    expect(getKnownMtimes(db)['restore.mp3']).toBe(42)
    markUnavailable(db, ['restore.mp3'])
    expect(getKnownMtimes(db)['restore.mp3']).toBeUndefined()
    expect(db.get<{ title: string }>('SELECT title FROM tracks')!.title).toBe('Original')
  } finally { db.close() }
})

it('moves duplicate playlist occurrences transactionally and rejects invalid positions', () => {
  const db = openDatabase(':memory:')
  try {
    for (const id of [1, 2, 3]) db.run('INSERT INTO tracks(id,path,title,date_added) VALUES(?,?,?,?)', [id, `${id}.mp3`, String(id), 1])
    const id = createPlaylist(db, 'Duplicates')
    addTracksToPlaylist(db, id, [1, 2, 1, 3])
    reorderPlaylist(db, id, 2, 3)
    expect(getPlaylistTracks(db, id).map((t) => t.id)).toEqual([1, 2, 3, 1])
    for (const position of [NaN, 0.5, -1, 4]) expect(() => reorderPlaylist(db, id, position, 0)).toThrow()
    expect(getPlaylistTracks(db, id).map((t) => t.id)).toEqual([1, 2, 3, 1])
  } finally { db.close() }
})
