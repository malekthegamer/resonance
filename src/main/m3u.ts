import { basename, dirname, isAbsolute, resolve, sep } from 'node:path'

/**
 * M3U / M3U8 parsing and writing.
 *
 * The whole job of this parser is tolerating files written by other software,
 * so it is deliberately permissive: any line ending, absolute or relative paths,
 * forward or back slashes, `file://` URLs, BOMs, and `#EXTINF` metadata that may
 * or may not be present.
 *
 * Pure (no electron, no fs) so it can be unit tested directly.
 */

export interface M3uEntry {
  /** Path exactly as written in the file. */
  raw: string
  /** Resolved against the playlist's own directory when relative. */
  path: string
  /** From #EXTINF, when present. */
  title?: string
  durationSec?: number
}

export interface ParsedM3u {
  name?: string
  entries: M3uEntry[]
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

function fromFileUrl(value: string): string {
  if (!/^file:\/\//i.test(value)) return value
  try {
    const url = new URL(value)
    let p = decodeURIComponent(url.pathname)
    // file:///C:/x -> /C:/x on Windows; drop the leading slash.
    if (/^\/[a-zA-Z]:/.test(p)) p = p.slice(1)
    return p
  } catch {
    return value
  }
}

/** Normalizes separators for the current platform. */
function normalizeSeparators(p: string): string {
  return sep === '\\' ? p.replace(/\//g, '\\') : p.replace(/\\/g, '/')
}

export function parseM3u(text: string, playlistPath?: string): ParsedM3u {
  const baseDir = playlistPath ? dirname(playlistPath) : undefined
  const lines = stripBom(text).split(/\r\n|\r|\n/)

  const entries: M3uEntry[] = []
  let name: string | undefined
  let pendingTitle: string | undefined
  let pendingDuration: number | undefined

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    if (trimmed.startsWith('#')) {
      const extinf = trimmed.match(/^#EXTINF\s*:\s*(-?\d+(?:\.\d+)?)\s*,\s*(.*)$/i)
      if (extinf) {
        const seconds = Number(extinf[1])
        // -1 is the conventional "unknown duration".
        pendingDuration = Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined
        pendingTitle = extinf[2]?.trim() || undefined
        continue
      }

      const playlistName = trimmed.match(/^#PLAYLIST\s*:\s*(.+)$/i)
      if (playlistName) {
        name = playlistName[1]!.trim()
        continue
      }

      // A bare comment immediately after #EXTM3U is often the playlist name in
      // files written by simple exporters — including the ones this app must
      // import. Treated as a name only if nothing better is found.
      if (!name && trimmed !== '#EXTM3U' && !trimmed.startsWith('#EXT')) {
        name = trimmed.slice(1).trim() || undefined
      }
      continue
    }

    const raw = trimmed
    let candidate = fromFileUrl(raw)
    candidate = normalizeSeparators(candidate)
    const path = isAbsolute(candidate) || !baseDir ? candidate : resolve(baseDir, candidate)

    entries.push({
      raw,
      path,
      ...(pendingTitle !== undefined ? { title: pendingTitle } : {}),
      ...(pendingDuration !== undefined ? { durationSec: pendingDuration } : {})
    })

    pendingTitle = undefined
    pendingDuration = undefined
  }

  if (!name && playlistPath) name = basename(playlistPath).replace(/\.m3u8?$/i, '')
  return { ...(name ? { name } : {}), entries }
}

export interface M3uWriteEntry {
  path: string
  title: string
  artist?: string
  durationSec?: number
}

/**
 * Writes an extended M3U.
 *
 * Always UTF-8 with `#EXTM3U`, and always LF-terminated lines... except that
 * Windows media players are happier with CRLF, so CRLF it is. Paths are written
 * absolutely: relative paths break the moment the playlist is moved, and this
 * export is meant to be handed to other applications.
 */
export function writeM3u(name: string, entries: M3uWriteEntry[]): string {
  const lines: string[] = ['#EXTM3U', `#PLAYLIST:${name}`]

  for (const entry of entries) {
    const seconds = Math.round(entry.durationSec ?? -1)
    const label = entry.artist ? `${entry.artist} - ${entry.title}` : entry.title
    lines.push(`#EXTINF:${seconds >= 0 ? seconds : -1},${label}`)
    lines.push(entry.path)
  }

  return lines.join('\r\n') + '\r\n'
}
