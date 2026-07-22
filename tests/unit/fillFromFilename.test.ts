import { describe, expect, it } from 'vitest'
import { baseName, fillFromFilename } from '@renderer/core/fillFromFilename'

/**
 * The parser behind the "Fill from filename" button.
 *
 * These cases come from the author's real library, which is where the awkward
 * ones were found. The button only populates a form the user then reviews, so a
 * wrong guess is a nuisance rather than corruption — but a guess that is wrong
 * in a *plausible* way is the dangerous kind, and those are what the guards
 * below exist to prevent.
 */

describe('baseName', () => {
  it('strips directories and the extension', () => {
    expect(baseName('C:\\Music\\Anime\\Guren no Yumiya.mp3')).toBe('Guren no Yumiya')
    expect(baseName('/home/x/y/Song.flac')).toBe('Song')
  })

  it('keeps dots that are part of the name', () => {
    expect(baseName('Mr. Sandman.mp3')).toBe('Mr. Sandman')
  })
})

describe('episode markers', () => {
  it('splits series from song title', () => {
    const g = fillFromFilename('Attack on Titan OP 1 Guren no Yumiya.mp3')
    expect(g.album).toBe('Attack on Titan')
    expect(g.title).toBe('Guren no Yumiya')
    expect(g.genre).toBe('Anime')
    expect(g.source).toBe('episode-marker')
  })

  it('handles Ending as well as Opening', () => {
    const g = fillFromFilename('Death Note Ending 2 Zetsubou Billy.mp3')
    expect(g.album).toBe('Death Note')
    expect(g.title).toBe('Zetsubou Billy')
  })

  // "Blue Lock OP Opening 1 Chaos ga Kiwamaru" repeats the marker.
  it('strips a repeated marker instead of leaving "Opening 1" as the title', () => {
    const g = fillFromFilename('Blue Lock OP Opening 1 Chaos ga Kiwamaru.mp3')
    expect(g.album).toBe('Blue Lock')
    expect(g.title).toBe('Chaos ga Kiwamaru')
  })

  // Otherwise a marker at position 0 would produce an empty album.
  it('ignores a marker with nothing before it', () => {
    const g = fillFromFilename('OP 1 Something.mp3')
    expect(g.album).toBe('')
  })
})

describe('artist detection', () => {
  it('reads "Title by Artist"', () => {
    const g = fillFromFilename('Unravel by TK.mp3')
    expect(g.artist).toBe('TK')
    expect(g.title).toBe('Unravel')
    expect(g.source).toBe('by-artist')
  })

  // "by" appears inside real titles; a long tail is not an artist name.
  it('ignores "by" when what follows is too long to be a name', () => {
    const g = fillFromFilename('A Song Written by Someone Who Was Very Tired Indeed.mp3')
    expect(g.artist).toBe('')
  })

  it('reads "Artist - Title"', () => {
    const g = fillFromFilename('Radwimps - Sparkle.mp3')
    expect(g.artist).toBe('Radwimps')
    expect(g.title).toBe('Sparkle')
    expect(g.source).toBe('dash')
  })

  /*
   * The guard that matters most. "Re Zero - Ending 2" splits on the dash into
   * artist "Re Zero" — a series name masquerading as a performer, which would
   * pollute the Artists view and split the album apart. Plausible and wrong is
   * worse than blank.
   */
  it('refuses to read a series name as an artist before an episode marker', () => {
    const g = fillFromFilename('Re Zero - Ending 2.mp3')
    expect(g.artist).toBe('')
  })
})

describe('noise stripping', () => {
  it.each([
    ['Guren no Yumiya [Creditless].mp3', 'Guren no Yumiya'],
    ['Sparkle (Official Music Video).mp3', 'Sparkle'],
    ['Unravel 1080p.mp3', 'Unravel'],
    ['Cruel Angel Thesis Full Version.mp3', 'Cruel Angel Thesis']
  ])('%s -> %s', (input, expected) => {
    expect(fillFromFilename(input).title).toBe(expected)
  })

  // Noise glued to the preceding word: no word boundary matches there.
  it('strips noise even with no space before it', () => {
    expect(fillFromFilename('CreditlessDeath Note.mp3').title).toBe('Death Note')
  })

  it('turns underscores into spaces', () => {
    expect(fillFromFilename('Guren_no_Yumiya.mp3').title).toBe('Guren no Yumiya')
  })
})

describe('degenerate input', () => {
  // A blank title renders as a row the user cannot identify, and in the form it
  // is indistinguishable from "no suggestion".
  it('always yields a non-empty title', () => {
    for (const name of ['[1080p].mp3', '___.mp3', '   .mp3', 'a.mp3']) {
      expect(fillFromFilename(name).title.length).toBeGreaterThan(0)
    }
  })

  it('suggests nothing beyond a title when the filename says nothing', () => {
    const g = fillFromFilename('track01.mp3')
    expect(g).toMatchObject({ title: 'track01', album: '', artist: '', genre: '' })
    expect(g.source).toBe('filename-only')
  })

  it('never returns undefined fields', () => {
    const g = fillFromFilename('x.mp3')
    for (const value of Object.values(g)) expect(typeof value).toBe('string')
  })
})
