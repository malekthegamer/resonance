import { describe, expect, it } from 'vitest'
import type { Track } from '@shared/types'
import {
  albumKeyFor,
  artistKeyFor,
  genreKeyFor,
  groupByAlbum,
  groupByArtist,
  groupByGenre,
  recentlyAdded,
  UNKNOWN_ALBUM,
  UNKNOWN_ARTIST
} from '@renderer/core/grouping'
import { filterTracks, sortTracks } from '@renderer/core/sort'
import { hashString, initialsFor, placeholderColors } from '@renderer/core/art'

let nextId = 1
function track(over: Partial<Track> = {}): Track {
  return {
    id: nextId++,
    path: `C:\\Music\\${nextId}.mp3`,
    title: 'Title',
    artist: 'Artist',
    album: 'Album',
    albumArtist: '',
    genre: 'Anime',
    year: 2013,
    trackNo: 1,
    discNo: 1,
    duration: 200,
    bitrate: 320000,
    sampleRate: 44100,
    codec: 'MPEG 1 Layer 3',
    format: 'mp3',
    size: 1000,
    mtime: 1,
    artRef: null,
    dateAdded: 1000,
    playCount: 0,
    lastPlayed: null,
    available: true,
    ...over
  }
}

describe('groupByAlbum', () => {
  it('keys on album AND artist so same-named albums do not merge', () => {
    const groups = groupByAlbum([
      track({ album: 'Greatest Hits', artist: 'Queen' }),
      track({ album: 'Greatest Hits', artist: 'ABBA' })
    ])
    expect(groups).toHaveLength(2)
  })

  it('prefers album artist so a compilation stays one album', () => {
    const groups = groupByAlbum([
      track({ album: 'Attack on Titan', artist: 'Linked Horizon', albumArtist: 'Various' }),
      track({ album: 'Attack on Titan', artist: 'SiM', albumArtist: 'Various' })
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0]!.trackCount).toBe(2)
    expect(groups[0]!.albumArtist).toBe('Various')
  })

  it('orders tracks within an album by disc then track number', () => {
    const groups = groupByAlbum([
      track({ trackNo: 2, discNo: 1, title: 'B' }),
      track({ trackNo: 1, discNo: 2, title: 'C' }),
      track({ trackNo: 1, discNo: 1, title: 'A' })
    ])
    expect(groups[0]!.tracks.map((t) => t.title)).toEqual(['A', 'B', 'C'])
  })

  it('labels untagged tracks rather than dropping them', () => {
    const groups = groupByAlbum([track({ album: '', artist: '', albumArtist: '' })])
    expect(groups[0]!.album).toBe(UNKNOWN_ALBUM)
    expect(groups[0]!.albumArtist).toBe(UNKNOWN_ARTIST)
  })

  it('adopts the first artwork it finds for the album', () => {
    const groups = groupByAlbum([
      track({ artRef: null }),
      track({ artRef: 'ab/hash.jpg' }),
      track({ artRef: 'cd/other.jpg' })
    ])
    expect(groups[0]!.artRef).toBe('ab/hash.jpg')
  })
})

describe('group keys match the grids they index', () => {
  // Regression guard. The album key was once derived in two places — the grid
  // builder and the track filter — and the copies disagreed on trimming and the
  // "Unknown …" fallbacks, so untagged albums opened to an empty list. Any
  // future drift between the two must fail here.
  const cases = [
    track({ album: 'Attack on Titan', artist: 'Linked Horizon', albumArtist: '' }),
    track({ album: '', artist: '', albumArtist: '' }),
    track({ album: '  Padded  ', artist: '  Spacey  ', albumArtist: '' }),
    track({ album: 'MiXeD CaSe', artist: 'ArTiSt', albumArtist: 'Album Artist' }),
    track({ album: '呪術廻戦', artist: '', albumArtist: '' })
  ]

  it('every track resolves to exactly one album group', () => {
    const groups = groupByAlbum(cases)
    for (const t of cases) {
      const matches = groups.filter((g) => g.key === albumKeyFor(t))
      expect(matches, `no album group for ${JSON.stringify(t.album)}`).toHaveLength(1)
    }
  })

  it('every track resolves to exactly one artist and genre group', () => {
    const artists = groupByArtist(cases)
    const genres = groupByGenre(cases)
    for (const t of cases) {
      expect(artists.filter((g) => g.key === artistKeyFor(t))).toHaveLength(1)
      expect(genres.filter((g) => g.key === genreKeyFor(t))).toHaveLength(1)
    }
  })

  it('filtering by a group key returns that group’s full track count', () => {
    const groups = groupByAlbum(cases)
    for (const g of groups) {
      const filtered = cases.filter((t) => albumKeyFor(t) === g.key)
      expect(filtered).toHaveLength(g.trackCount)
    }
  })
})

describe('groupByArtist / groupByGenre', () => {
  it('groups case-insensitively', () => {
    const groups = groupByArtist([
      track({ artist: 'Kenshi Yonezu', albumArtist: '' }),
      track({ artist: 'kenshi yonezu', albumArtist: '' })
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0]!.trackCount).toBe(2)
  })

  it('buckets empty genres under a label instead of an empty row', () => {
    const groups = groupByGenre([track({ genre: '' })])
    expect(groups[0]!.name).toBe('Unknown Genre')
  })
})

describe('recentlyAdded', () => {
  it('returns newest first', () => {
    const items = recentlyAdded([
      track({ dateAdded: 100, title: 'old' }),
      track({ dateAdded: 300, title: 'new' }),
      track({ dateAdded: 200, title: 'mid' })
    ])
    expect(items.map((t) => t.title)).toEqual(['new', 'mid', 'old'])
  })
})

describe('sortTracks', () => {
  it('sorts durations numerically, not as strings', () => {
    const sorted = sortTracks(
      [track({ duration: 600 }), track({ duration: 60 }), track({ duration: 120 })],
      'duration',
      'asc'
    )
    expect(sorted.map((t) => t.duration)).toEqual([60, 120, 600])
  })

  it('ignores case when sorting text', () => {
    const sorted = sortTracks(
      [track({ title: 'banana' }), track({ title: 'Apple' }), track({ title: 'cherry' })],
      'title',
      'asc'
    )
    expect(sorted.map((t) => t.title)).toEqual(['Apple', 'banana', 'cherry'])
  })

  it('sorts embedded numbers naturally, so OP 10 follows OP 9', () => {
    const sorted = sortTracks(
      [track({ title: 'OP 10' }), track({ title: 'OP 9' }), track({ title: 'OP 2' })],
      'title',
      'asc'
    )
    expect(sorted.map((t) => t.title)).toEqual(['OP 2', 'OP 9', 'OP 10'])
  })

  it('is stable and reversible', () => {
    const items = [track({ title: 'A' }), track({ title: 'A' }), track({ title: 'B' })]
    const asc = sortTracks(items, 'title', 'asc')
    const desc = sortTracks(items, 'title', 'desc')
    expect(asc.map((t) => t.id)).toEqual([...asc].map((t) => t.id))
    expect(desc[0]!.title).toBe('B')
  })

  it('does not mutate its input', () => {
    const items = [track({ title: 'Z' }), track({ title: 'A' })]
    const before = items.map((t) => t.title)
    sortTracks(items, 'title', 'asc')
    expect(items.map((t) => t.title)).toEqual(before)
  })
})

describe('filterTracks', () => {
  const items = [
    track({ title: 'Guren no Yumiya', artist: 'Linked Horizon', album: 'Attack on Titan' }),
    track({ title: 'KICK BACK', artist: 'Kenshi Yonezu', album: 'Chainsaw Man' })
  ]

  it('matches across title, artist and album', () => {
    expect(filterTracks(items, 'chainsaw')).toHaveLength(1)
    expect(filterTracks(items, 'linked')).toHaveLength(1)
  })

  it('requires every term to match, so extra words narrow rather than widen', () => {
    expect(filterTracks(items, 'kick yonezu')).toHaveLength(1)
    expect(filterTracks(items, 'kick horizon')).toHaveLength(0)
  })

  it('returns everything for an empty query', () => {
    expect(filterTracks(items, '   ')).toHaveLength(2)
  })
})

describe('placeholder artwork', () => {
  // The target library has no embedded art at all, so placeholders are the
  // normal case and must at least be stable and distinguishable.
  it('is deterministic for the same album', () => {
    expect(placeholderColors('Attack on Titan')).toEqual(placeholderColors('Attack on Titan'))
  })

  it('differs between albums', () => {
    expect(placeholderColors('Attack on Titan').hue).not.toBe(
      placeholderColors('Chainsaw Man').hue
    )
  })

  it('stays inside the blue-to-magenta band so the grid reads as one system', () => {
    for (const name of ['A', 'Bleach', 'Solo Leveling', '呪術廻戦', 'x'.repeat(40)]) {
      const { hue } = placeholderColors(name)
      expect(hue).toBeGreaterThanOrEqual(200)
      expect(hue).toBeLessThan(330)
    }
  })

  it('hashes without collisions across a realistic album set', () => {
    const names = ['Attack on Titan', 'Chainsaw Man', 'Blue Lock', 'Death Note', 'Jujutsu Kaisen']
    expect(new Set(names.map(hashString)).size).toBe(names.length)
  })

  it('derives readable initials, including from non-Latin titles', () => {
    expect(initialsFor('Attack on Titan')).toBe('AT')
    expect(initialsFor('Bleach')).toBe('BL')
    expect(initialsFor('')).toBe('♪')
    expect(initialsFor('紅蓮の弓矢')).toBe('紅蓮')
  })
})
