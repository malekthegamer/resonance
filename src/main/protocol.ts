import { createReadStream, statSync } from 'node:fs'
import { extname } from 'node:path'
import { Readable } from 'node:stream'
import { protocol } from 'electron'
import { getDb } from './db/open'
import { getTrackById } from './db/tracks'
import { artCacheDir } from './scan/controller'
import { resolveArtPath } from './scan/art'

/**
 * Custom protocols that let the sandboxed renderer load local media without
 * ever seeing — or supplying — a filesystem path (plan §A2).
 *
 *   resonance-art://art/<sha-sharded-ref>   album artwork
 *   resonance-media://track/<id>            audio
 *
 * Security invariant: these handlers accept opaque identifiers only. A track id
 * is resolved to a real path through the database; an art ref is pattern-checked
 * and joined under the cache directory. A compromised renderer cannot read
 * arbitrary files by asking for them.
 */

export const MEDIA_SCHEME = 'resonance-media'
export const ART_SCHEME = 'resonance-art'

/**
 * Must run before app.whenReady().
 *
 * `stream` and `supportFetchAPI` are what make HTTP range requests work; without
 * them seeking inside a large file breaks silently. `corsEnabled` plus the
 * Access-Control-Allow-Origin header below plus `crossOrigin="anonymous"` on the
 * audio element are the three pieces that keep Web Audio from outputting silence
 * for a cross-origin media resource (§A2b) — all three are required together.
 */
export function registerSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: MEDIA_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        bypassCSP: false,
        corsEnabled: true
      }
    },
    {
      scheme: ART_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        bypassCSP: false,
        corsEnabled: true
      }
    }
  ])
}

function notFound(): Response {
  return new Response('Not found', { status: 404 })
}

const MIME_BY_EXT: Readonly<Record<string, string>> = {
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.wav': 'audio/wav',
  '.wave': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.m4b': 'audio/mp4',
  '.aac': 'audio/aac',
  '.mp4': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.wma': 'audio/x-ms-wma',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp'
}

/**
 * Serves a file with explicit byte-range support.
 *
 * Range handling is implemented here rather than delegated, because delegating
 * did not reliably set `Content-Length`. Without it Chromium cannot determine a
 * media file's duration: `el.duration` stays `Infinity`, the seek bar has no
 * scale, and seeking is impossible — on a 112 MB file that presented as
 * "duration 0" while playback ran perfectly happily.
 *
 * `Accept-Ranges` plus a correct 206 `Content-Range` is what makes seeking into
 * a large file work at all, rather than forcing a download of everything before
 * the target.
 */
function serveFile(absPath: string, request: Request): Response {
  let size: number
  try {
    const info = statSync(absPath)
    if (!info.isFile()) return notFound()
    size = info.size
  } catch {
    return notFound()
  }

  const contentType = MIME_BY_EXT[extname(absPath).toLowerCase()] ?? 'application/octet-stream'
  const headers = new Headers({
    'Content-Type': contentType,
    'Accept-Ranges': 'bytes',
    // Required for Web Audio: a cross-origin media element that is not
    // CORS-approved feeds the analyser silence (plan §A2b).
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-cache'
  })

  const range = request.headers.get('Range')
  const match = range?.match(/^bytes=(\d*)-(\d*)$/)

  if (match) {
    const startRaw = match[1]
    const endRaw = match[2]

    let start: number
    let end: number
    if (startRaw === '' && endRaw !== '') {
      // Suffix form: "bytes=-500" means the final 500 bytes.
      const suffix = Number(endRaw)
      start = Math.max(0, size - suffix)
      end = size - 1
    } else {
      start = Number(startRaw || 0)
      end = endRaw ? Number(endRaw) : size - 1
    }

    if (!Number.isFinite(start) || start >= size || start < 0) {
      headers.set('Content-Range', `bytes */${size}`)
      return new Response(null, { status: 416, headers })
    }
    end = Math.min(end, size - 1)
    const length = end - start + 1

    headers.set('Content-Range', `bytes ${start}-${end}/${size}`)
    headers.set('Content-Length', String(length))

    const stream = Readable.toWeb(
      createReadStream(absPath, { start, end })
    ) as unknown as ReadableStream
    return new Response(stream, { status: 206, headers })
  }

  headers.set('Content-Length', String(size))
  const stream = Readable.toWeb(createReadStream(absPath)) as unknown as ReadableStream
  return new Response(stream, { status: 200, headers })
}

export function registerProtocolHandlers(): void {
  protocol.handle(ART_SCHEME, async (request) => {
    // standard:true parses these as host + path, so "art/ab/hash.jpg" arrives as
    // host="art", pathname="/ab/hash.jpg".
    const url = new URL(request.url)
    const ref = decodeURIComponent(url.pathname.replace(/^\//, ''))
    const abs = resolveArtPath(artCacheDir(), ref)
    if (!abs) return notFound()
    try {
      return serveFile(abs, request)
    } catch {
      return notFound()
    }
  })

  protocol.handle(MEDIA_SCHEME, async (request) => {
    const url = new URL(request.url)
    const id = Number(decodeURIComponent(url.pathname.replace(/^\//, '')))
    if (!Number.isInteger(id) || id <= 0) return notFound()

    const track = getTrackById(getDb(), id)
    if (!track) return notFound()

    try {
      return serveFile(track.path, request)
    } catch {
      // File moved or deleted since the scan. Mark it rather than crash playback.
      getDb().run('UPDATE tracks SET available = 0 WHERE id = ?', [id])
      return notFound()
    }
  })
}

/** URL builders, so the shape lives in exactly one place. */
export function mediaUrl(trackId: number): string {
  return `${MEDIA_SCHEME}://track/${trackId}`
}

export function artUrl(ref: string): string {
  return `${ART_SCHEME}://art/${ref.replace(/\\/g, '/')}`
}
