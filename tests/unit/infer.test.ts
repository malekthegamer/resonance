import { describe, expect, it } from 'vitest'
import {
  applyInference,
  canonicalizeAlbums,
  foldName,
  inferFromFilename
} from '../../src/main/scan/infer'

/**
 * Fixtures are real filenames from an untagged library — the exact shapes the
 * parser has to survive, including rip noise and glued prefixes.
 */
describe('inferFromFilename', () => {
  it('splits series from title on an episode marker', () => {
    const r = inferFromFilename('Attack on Titan OP 1 Guren No Yumiya.mp3')
    expect(r.album).toBe('Attack on Titan')
    expect(r.title).toBe('Guren No Yumiya')
    expect(r.genre).toBe('Anime')
    expect(r.source).toBe('episode-marker')
  })

  it('handles Opening/Ending spelled out', () => {
    expect(inferFromFilename('CHAINSAW MAN Opening KICK BACK.mp3')).toMatchObject({
      album: 'CHAINSAW MAN',
      title: 'KICK BACK'
    })
    expect(inferFromFilename('Blue Lock ED 1 WINNER.mp3')).toMatchObject({
      album: 'Blue Lock',
      title: 'WINNER'
    })
  })

  it('extracts an artist from "Title by Artist"', () => {
    const r = inferFromFilename('BLUE LOCK 2nd Season Ending  One by Snow Man.mp3')
    expect(r.album).toBe('BLUE LOCK 2nd Season')
    expect(r.title).toBe('One')
    expect(r.artist).toBe('Snow Man')
  })

  // These all failed the first version of the parser.
  it('strips rip noise glued to adjacent words', () => {
    expect(inferFromFilename('CreditlessDeath Note OP  Opening 2UHD 60FPS.mp3').album).toBe(
      'Death Note'
    )
    expect(inferFromFilename('CreditlessJujutsu Kaisen ED  Ending 1UHD 60FPS.mp3').album).toBe(
      'Jujutsu Kaisen'
    )
  })

  it('does not leave a repeated marker as the title', () => {
    const r = inferFromFilename('Blue Lock OP  Opening 1UHD 60FPS.mp3')
    expect(r.album).toBe('Blue Lock')
    expect(r.title).not.toMatch(/uhd/i)
    expect(r.title).not.toMatch(/60\s*fps/i)
  })

  // A series name is not a performer. Guessing wrong here is worse than not
  // guessing: it fills the Artists view with show titles and splits albums.
  it('does not mistake a series name for an artist', () => {
    for (const name of ['Re Zero - Ending 2.mp3', 'Death Note - Opening 1.mp3']) {
      expect(inferFromFilename(name).artist).toBe('')
    }
  })

  it('keeps unparseable names as a plain title rather than inventing data', () => {
    const r = inferFromFilename('Thriller.mp3')
    expect(r.title).toBe('Thriller')
    expect(r.album).toBe('')
    expect(r.artist).toBe('')
    expect(r.genre).toBe('')
    expect(r.source).toBe('filename-only')
  })

  it('never returns an empty title', () => {
    for (const name of ['OP.mp3', '   .mp3', 'a.mp3', '紅蓮の弓矢.mp3']) {
      expect(inferFromFilename(name).title.length).toBeGreaterThan(0)
    }
  })
})

describe('applyInference', () => {
  it('never overwrites a real tag', () => {
    const out = applyInference('Attack on Titan OP 1 Guren No Yumiya.mp3', {
      title: 'Real Title',
      album: 'Real Album',
      artist: 'Real Artist',
      genre: 'Rock'
    })
    expect(out).toEqual({
      title: 'Real Title',
      album: 'Real Album',
      artist: 'Real Artist',
      genre: 'Rock'
    })
  })

  it('fills only the empty fields', () => {
    const out = applyInference('Attack on Titan OP 1 Guren No Yumiya.mp3', {
      title: '',
      album: '',
      artist: 'Linked Horizon',
      genre: ''
    })
    expect(out.title).toBe('Guren No Yumiya')
    expect(out.album).toBe('Attack on Titan')
    expect(out.artist).toBe('Linked Horizon')
    expect(out.genre).toBe('Anime')
  })
})

describe('canonicalizeAlbums', () => {
  it('merges case and spacing variants', () => {
    const map = canonicalizeAlbums(['Jujutsu Kaisen', 'JUJUTSU KAISEN', 'Jujutsu Kaisen'])
    expect(new Set(map.values()).size).toBe(1)
  })

  // The real motivator: this library spelled one series six different ways.
  it('collapses the Re:Zero family into a single album', () => {
    const variants = [
      'Re Zero',
      'ReZero',
      'Rezero',
      'Re ZERO - Starting Life in Another World',
      'Re ZERO -Starting Life in Another World',
      'Re ZERO -Starting Life in Another World- Season 2'
    ]
    const map = canonicalizeAlbums(variants)
    expect(new Set(map.values()).size).toBe(1)
  })

  it('picks the most common spelling as the display name', () => {
    const map = canonicalizeAlbums(['Blue Lock', 'Blue Lock', 'BLUE LOCK', 'blue lock'])
    expect([...new Set(map.values())][0]).toBe('Blue Lock')
  })

  it('keeps genuinely different series apart', () => {
    const map = canonicalizeAlbums(['Attack on Titan', 'Chainsaw Man', 'Solo Leveling'])
    expect(new Set(map.values()).size).toBe(3)
  })

  it('does not merge on a too-short shared prefix', () => {
    // "Bleach" and "Blend S" share "Ble" but are unrelated.
    const map = canonicalizeAlbums(['Bleach', 'Blend S'])
    expect(new Set(map.values()).size).toBe(2)
  })

  it('is idempotent', () => {
    const first = canonicalizeAlbums(['Re Zero', 'ReZero', 'Rezero'])
    const names = [...new Set(first.values())]
    const second = canonicalizeAlbums(names)
    expect([...new Set(second.values())]).toEqual(names)
  })
})

describe('foldName', () => {
  it('ignores case, spacing and punctuation', () => {
    expect(foldName('Re ZERO -Starting Life!')).toBe('rezerostartinglife')
    expect(foldName('Blue Lock')).toBe(foldName('BLUELOCK'))
  })
})
