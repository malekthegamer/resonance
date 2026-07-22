import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseM3u, writeM3u } from '../../src/main/m3u'

/**
 * The parser's entire job is tolerating files written by other software, so the
 * cases below are the shapes real exporters produce — plus the user's own
 * playlists, which are the best fixtures available.
 */
describe('parseM3u', () => {
  it('parses absolute Windows paths', () => {
    const text = ['#EXTM3U', 'C:\\Users\\me\\Music\\a.mp3', 'C:\\Users\\me\\Music\\b.mp3'].join('\r\n')
    const { entries } = parseM3u(text)
    expect(entries).toHaveLength(2)
    expect(entries[0]!.path).toBe('C:\\Users\\me\\Music\\a.mp3')
  })

  it('resolves relative paths against the playlist directory', () => {
    const text = '#EXTM3U\nsub\\song.mp3\n'
    const { entries } = parseM3u(text, 'C:\\Music\\lists\\mine.m3u8')
    expect(entries[0]!.path.toLowerCase()).toContain('c:\\music\\lists\\sub\\song.mp3')
  })

  it('reads #EXTINF duration and title', () => {
    const text = ['#EXTM3U', '#EXTINF:241,Linked Horizon - Guren no Yumiya', 'C:\\a.mp3'].join('\n')
    const { entries } = parseM3u(text)
    expect(entries[0]!.durationSec).toBe(241)
    expect(entries[0]!.title).toBe('Linked Horizon - Guren no Yumiya')
  })

  it('treats -1 duration as unknown rather than negative', () => {
    const { entries } = parseM3u('#EXTM3U\n#EXTINF:-1,Unknown\nC:\\a.mp3')
    expect(entries[0]!.durationSec).toBeUndefined()
  })

  it('handles CRLF, LF and CR line endings alike', () => {
    for (const eol of ['\r\n', '\n', '\r']) {
      const { entries } = parseM3u(['#EXTM3U', 'C:\\a.mp3', 'C:\\b.mp3'].join(eol))
      expect(entries).toHaveLength(2)
    }
  })

  it('strips a UTF-8 BOM instead of corrupting the first path', () => {
    const { entries } = parseM3u('﻿#EXTM3U\nC:\\a.mp3')
    expect(entries).toHaveLength(1)
    expect(entries[0]!.path).toBe('C:\\a.mp3')
  })

  it('decodes file:// URLs, including percent-encoding', () => {
    const { entries } = parseM3u('#EXTM3U\nfile:///C:/Music/Guren%20no%20Yumiya.mp3')
    expect(entries[0]!.path).toBe('C:\\Music\\Guren no Yumiya.mp3')
  })

  it('preserves non-ASCII paths exactly', () => {
    const p = 'C:\\Music\\紅蓮の弓矢.mp3'
    const { entries } = parseM3u(`#EXTM3U\n${p}`)
    expect(entries[0]!.path).toBe(p)
  })

  it('skips blank lines and unknown directives', () => {
    const text = '#EXTM3U\n\n#EXTGRP:Anime\n\nC:\\a.mp3\n\n'
    expect(parseM3u(text).entries).toHaveLength(1)
  })

  it('reads a playlist name from #PLAYLIST or the filename', () => {
    expect(parseM3u('#EXTM3U\n#PLAYLIST:My Mix\nC:\\a.mp3').name).toBe('My Mix')
    expect(parseM3u('#EXTM3U\nC:\\a.mp3', 'C:\\lists\\Attack on Titan.m3u8').name).toBe(
      'Attack on Titan'
    )
  })

  it('returns nothing for an empty or header-only file', () => {
    expect(parseM3u('').entries).toHaveLength(0)
    expect(parseM3u('#EXTM3U\n').entries).toHaveLength(0)
  })
})

describe('writeM3u', () => {
  it('round-trips through the parser', () => {
    const text = writeM3u('Test', [
      { path: 'C:\\Music\\a.mp3', title: 'A', artist: 'Artist', durationSec: 200 },
      { path: 'C:\\Music\\紅蓮.mp3', title: '紅蓮の弓矢', durationSec: 241 }
    ])

    const parsed = parseM3u(text)
    expect(parsed.name).toBe('Test')
    expect(parsed.entries).toHaveLength(2)
    expect(parsed.entries[0]!.path).toBe('C:\\Music\\a.mp3')
    expect(parsed.entries[0]!.title).toBe('Artist - A')
    expect(parsed.entries[0]!.durationSec).toBe(200)
    // Non-ASCII must survive a full write/read cycle.
    expect(parsed.entries[1]!.path).toBe('C:\\Music\\紅蓮.mp3')
  })

  it('emits -1 for unknown durations', () => {
    expect(writeM3u('X', [{ path: 'C:\\a.mp3', title: 'A' }])).toContain('#EXTINF:-1,A')
  })

  it('uses CRLF, which Windows players expect', () => {
    expect(writeM3u('X', [{ path: 'C:\\a.mp3', title: 'A' }])).toContain('\r\n')
  })

  it('survives an empty playlist', () => {
    const parsed = parseM3u(writeM3u('Empty', []))
    expect(parsed.entries).toHaveLength(0)
    expect(parsed.name).toBe('Empty')
  })
})

/**
 * Real-world fixtures. These are the user's own playlists — absolute Windows
 * paths, non-ASCII titles, and a bare comment line used as the playlist name.
 */
describe("the user's actual .m3u8 playlists", () => {
  const dir = join(homedir(), 'Music', 'playlists')
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => /\.m3u8?$/i.test(f)) : []

  it.runIf(files.length > 0)('parses every one without losing entries', () => {
    let totalEntries = 0
    for (const file of files) {
      const full = join(dir, file)
      const parsed = parseM3u(readFileSync(full, 'utf8'), full)

      expect(parsed.name, `${file} should yield a name`).toBeTruthy()
      expect(parsed.entries.length, `${file} should contain tracks`).toBeGreaterThan(0)

      for (const entry of parsed.entries) {
        expect(entry.path, `${file}: entry should be absolute`).toMatch(/^[a-zA-Z]:\\/)
        expect(entry.path).toMatch(/\.(mp3|flac|wav|m4a|ogg|opus)$/i)
      }
      totalEntries += parsed.entries.length
    }

    // eslint-disable-next-line no-console
    console.log(`\nParsed ${files.length} real playlists, ${totalEntries} entries total`)
    expect(totalEntries).toBeGreaterThan(0)
  })
})
