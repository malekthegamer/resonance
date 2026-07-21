import { pathToFileURL } from 'node:url'
import { net, protocol } from 'electron'
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

/** Serves a real file through net.fetch, which preserves byte-range support. */
async function serveFile(absPath: string, request: Request): Promise<Response> {
  const upstream = await net.fetch(pathToFileURL(absPath).toString(), {
    headers: request.headers,
    // Range headers must survive to the file handler or seeking breaks.
    bypassCustomProtocolHandlers: true
  })

  const headers = new Headers(upstream.headers)
  headers.set('Access-Control-Allow-Origin', '*')
  headers.set('Cache-Control', 'no-cache')

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers
  })
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
      return await serveFile(abs, request)
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
      return await serveFile(track.path, request)
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
