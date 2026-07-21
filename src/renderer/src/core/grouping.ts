import type { Track } from '@shared/types'

/**
 * Derives the Albums / Artists / Genres views from the flat track list.
 *
 * Kept pure and separate from React so the grouping rules — which are where the
 * fiddly decisions live (untagged tracks, album-artist vs artist, albums that
 * share a name across artists) — can be tested directly.
 */

export const UNKNOWN_ARTIST = 'Unknown Artist'
export const UNKNOWN_ALBUM = 'Unknown Album'
export const UNKNOWN_GENRE = 'Unknown Genre'

export interface AlbumGroup {
  key: string
  album: string
  albumArtist: string
  year: number | null
  trackCount: number
  duration: number
  artRef: string | null
  tracks: Track[]
}

export interface SimpleGroup {
  key: string
  name: string
  trackCount: number
  duration: number
  artRef: string | null
}

function labelArtist(t: Track): string {
  return t.albumArtist?.trim() || t.artist?.trim() || UNKNOWN_ARTIST
}

/*
 * Group keys are derived here and nowhere else.
 *
 * These exist because the key was previously computed both when building the
 * grids and again when filtering tracks for a selected group. The two copies
 * disagreed on trimming and on the "Unknown …" fallbacks, so any untagged album
 * opened to an empty list. One definition, used by both sides.
 */

export function albumKeyFor(t: Track): string {
  const album = t.album?.trim() || UNKNOWN_ALBUM
  return `${album} ${labelArtist(t)}`.toLowerCase()
}

export function artistKeyFor(t: Track): string {
  return labelArtist(t).toLowerCase()
}

export function genreKeyFor(t: Track): string {
  return (t.genre?.trim() || UNKNOWN_GENRE).toLowerCase()
}

/**
 * Albums are keyed by album name **plus** album artist. Keying on the name alone
 * would merge every self-titled or generically-named album — "Greatest Hits" by
 * three artists would collapse into one broken album.
 */
export function groupByAlbum(tracks: Track[]): AlbumGroup[] {
  const map = new Map<string, AlbumGroup>()

  for (const t of tracks) {
    const album = t.album?.trim() || UNKNOWN_ALBUM
    const albumArtist = labelArtist(t)
    const key = albumKeyFor(t)

    let group = map.get(key)
    if (!group) {
      group = {
        key,
        album,
        albumArtist,
        year: t.year,
        trackCount: 0,
        duration: 0,
        artRef: null,
        tracks: []
      }
      map.set(key, group)
    }

    group.trackCount++
    group.duration += t.duration
    group.tracks.push(t)
    // First available artwork represents the album; most albums have one cover
    // and scanning order is stable.
    if (!group.artRef && t.artRef) group.artRef = t.artRef
    if (group.year == null && t.year != null) group.year = t.year
  }

  for (const group of map.values()) {
    group.tracks.sort(
      (a, b) => (a.discNo ?? 1) - (b.discNo ?? 1) || (a.trackNo ?? 0) - (b.trackNo ?? 0)
    )
  }

  return [...map.values()].sort(
    (a, b) =>
      a.albumArtist.localeCompare(b.albumArtist, undefined, { sensitivity: 'base' }) ||
      a.album.localeCompare(b.album, undefined, { sensitivity: 'base' })
  )
}

function groupBy(tracks: Track[], pick: (t: Track) => string): SimpleGroup[] {
  const map = new Map<string, SimpleGroup>()

  for (const t of tracks) {
    const name = pick(t)
    const key = name.toLowerCase()
    let group = map.get(key)
    if (!group) {
      group = { key, name, trackCount: 0, duration: 0, artRef: null }
      map.set(key, group)
    }
    group.trackCount++
    group.duration += t.duration
    if (!group.artRef && t.artRef) group.artRef = t.artRef
  }

  return [...map.values()].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  )
}

export function groupByArtist(tracks: Track[]): SimpleGroup[] {
  return groupBy(tracks, labelArtist)
}

export function groupByGenre(tracks: Track[]): SimpleGroup[] {
  return groupBy(tracks, (t) => t.genre?.trim() || UNKNOWN_GENRE)
}

/** Newest first. Ties broken by id so the order is stable between renders. */
export function recentlyAdded(tracks: Track[], limit = 200): Track[] {
  return [...tracks].sort((a, b) => b.dateAdded - a.dateAdded || b.id - a.id).slice(0, limit)
}
