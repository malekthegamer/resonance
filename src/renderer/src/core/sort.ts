import type { Track } from '@shared/types'

export type SortKey = 'title' | 'artist' | 'album' | 'duration' | 'dateAdded' | 'trackNo'
export type SortDir = 'asc' | 'desc'

/**
 * Table sorting. Pure so the comparator rules can be tested without a DOM.
 *
 * Text uses localeCompare with base sensitivity so "ash" and "ASH" sort together
 * rather than splitting on case, which is what a user browsing a music library
 * expects. Numeric fields must never fall through to string comparison, or
 * durations sort as "1:00, 10:00, 2:00".
 */

function text(a: string, b: string): number {
  return (a || '').localeCompare(b || '', undefined, { sensitivity: 'base', numeric: true })
}

const COMPARATORS: Record<SortKey, (a: Track, b: Track) => number> = {
  title: (a, b) => text(a.title, b.title),
  artist: (a, b) => text(a.artist, b.artist) || text(a.album, b.album),
  album: (a, b) => text(a.album, b.album) || (a.trackNo ?? 0) - (b.trackNo ?? 0),
  duration: (a, b) => a.duration - b.duration,
  dateAdded: (a, b) => a.dateAdded - b.dateAdded,
  trackNo: (a, b) => (a.discNo ?? 1) - (b.discNo ?? 1) || (a.trackNo ?? 0) - (b.trackNo ?? 0)
}

export function sortTracks(tracks: Track[], key: SortKey, dir: SortDir): Track[] {
  const cmp = COMPARATORS[key]
  const sign = dir === 'asc' ? 1 : -1
  // id is the final tiebreaker so sorting is stable and repeatable.
  return [...tracks].sort((a, b) => sign * (cmp(a, b) || a.id - b.id))
}

/**
 * Client-side substring filter for narrowing the current view as you type.
 * Global search goes through the FTS index in the main process instead; this is
 * the cheap in-view filter that needs no round trip.
 */
export function filterTracks(tracks: Track[], query: string): Track[] {
  const q = query.trim().toLowerCase()
  if (!q) return tracks
  const terms = q.split(/\s+/)
  return tracks.filter((t) => {
    const haystack = `${t.title} ${t.artist} ${t.album} ${t.genre}`.toLowerCase()
    return terms.every((term) => haystack.includes(term))
  })
}
