/**
 * Filename-based metadata inference.
 *
 * Some libraries carry no tags at all. Rather than show every such track under
 * "Unknown Album / Unknown Artist", Resonance infers what it safely can from the
 * filename.
 *
 * Two rules govern this, and both matter:
 *   1. A real tag ALWAYS wins. Inference only fills genuinely empty fields.
 *   2. Nothing is written to disk. Inferred values live in the database only, so
 *      a rescan re-derives them and the user's files are never modified.
 *
 * No electron import — runs inside the scan worker and unit-tests under Node.
 */

export interface Inferred {
  title: string
  album: string
  artist: string
  genre: string
  /** Which rule fired, for reporting and debugging. */
  source: 'episode-marker' | 'by-artist' | 'dash' | 'filename-only'
}

/**
 * Rip/encode noise that carries no meaning. Stripped before parsing so it does
 * not end up inside an inferred title.
 */
const NOISE = [
  // No trailing \b: these appear glued to the next word in real filenames
  // ("CreditlessDeath Note", "LyricsRe Zero"), where a word boundary never
  // matches and the noise survives into the inferred album name.
  /creditless/gi,
  /\blyrics?/gi,
  /\bnon-?credit\b/gi,
  // Likewise glued to a digit: "Opening 1UHD 60FPS".
  /\d*\s*uhd\b/gi,
  /\b\d{2,3}\s*fps\b/gi,
  /\b(4k|1080p|720p|hd)\b/gi,
  /\b(netflix|crunchyroll|youtube)\b/gi,
  /\b(official\s+)?(music\s+)?video\b/gi,
  /\bfull\s+ver(sion)?\.?\b/gi,
  /\bcc\b/gi,
  /\[[^\]]*\]/g,
  /\([^)]*\)/g
]

/**
 * Marks the boundary between a series name and a song title:
 *   "Attack on Titan OP 1 Guren no Yumiya" -> series | OP 1 | title
 * The optional number is the season/opening index, not part of either side.
 */
const EPISODE_MARKER =
  /\s[-–—]?\s*\b(op|ed|opening|ending|insert\s*song|theme)\b\s*#?\s*(\d+)?\s*[-–—:]?\s*/i

/** "Title by Artist" — the only artist signal these filenames reliably carry. */
const BY_ARTIST = /\s+by\s+(.+)$/i

function clean(text: string): string {
  let out = text
  for (const pattern of NOISE) out = out.replace(pattern, ' ')
  return out
    .replace(/[_]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s\-–—:·]+|[\s\-–—:·]+$/g, '')
    .trim()
}

export function baseName(path: string): string {
  const file = path.split(/[\\/]/).pop() ?? path
  return file.replace(/\.[^.]+$/, '')
}

/**
 * Infers what it can from a filename. Always returns a usable title; album,
 * artist and genre are empty when nothing reliable could be determined —
 * inventing an artist from a filename that does not name one would be worse
 * than leaving it blank.
 */
export function inferFromFilename(path: string): Inferred {
  const raw = clean(baseName(path))

  let album = ''
  let genre = ''
  let artist = ''
  let title = raw
  let source: Inferred['source'] = 'filename-only'

  const marker = raw.match(EPISODE_MARKER)
  if (marker && marker.index !== undefined && marker.index > 0) {
    const before = clean(raw.slice(0, marker.index))
    const after = clean(raw.slice(marker.index + marker[0].length))

    // Only accept the split if both halves survived cleaning; otherwise the
    // marker was part of the title itself.
    if (before && after) {
      album = before
      // Filenames often repeat the marker ("Blue Lock OP Opening 1"), leaving a
      // stray "Opening 2" as the title. Strip a leading repeat, but only if
      // something is left afterwards.
      const deduped = clean(after.replace(/^\s*(op|ed|opening|ending)\b\s*#?\s*\d*\s*[-–—:]?\s*/i, ''))
      title = deduped || after
      // An OP/ED/Insert Song marker is a strong signal about the content.
      genre = 'Anime'
      source = 'episode-marker'
    }
  }

  const by = title.match(BY_ARTIST)
  if (by?.[1]) {
    const candidate = clean(by[1])
    // Guard against titles that legitimately contain "by".
    if (candidate && candidate.split(/\s+/).length <= 4) {
      artist = candidate
      title = clean(title.slice(0, by.index))
      if (source === 'filename-only') source = 'by-artist'
    }
  }

  // "Artist - Title", the other common convention.
  //
  // Only applied when the right-hand side does not look like an episode marker.
  // Without that guard, "Re Zero - Ending 2" yields artist "Re Zero" — a series
  // name masquerading as a performer, which pollutes the Artists view and splits
  // albums apart. When in doubt, infer nothing.
  if (!album && !artist) {
    const dash = raw.match(/^(.{2,40}?)\s+[-–—]\s+(.+)$/)
    const rhsIsMarker = dash?.[2] ? /^(op|ed|opening|ending|theme)\b/i.test(dash[2].trim()) : false
    if (dash?.[1] && dash[2] && !rhsIsMarker) {
      artist = clean(dash[1])
      title = clean(dash[2])
      source = 'dash'
    }
  }

  // A filename of only noise or whitespace must still yield something showable;
  // an empty title renders as a blank row the user cannot identify or click.
  const finalTitle = title || raw || baseName(path).trim() || 'Untitled'
  return { title: finalTitle, album, artist, genre, source }
}

/** Comparison key: case, spacing and punctuation removed. */
export function foldName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * Collapses spelling variants of the same series into one album name.
 *
 * Untagged libraries name the same show many ways — "Re Zero", "ReZero",
 * "Rezero", "Re ZERO - Starting Life in Another World", "… Season 2" — which
 * would otherwise appear as six separate albums. Two rules:
 *
 *   1. Names that fold to the same key are the same album.
 *   2. If one folded key is a prefix of another, the longer is a more specific
 *      form of the shorter (a season or subtitle) and folds into it.
 *
 * The display name is the variant that occurs most often, breaking ties toward
 * the shortest — so the series-level name wins over a long subtitled one.
 *
 * Applied ONLY to inferred album names. A real album tag is never rewritten:
 * two genuinely distinct albums can legitimately share a name prefix.
 */
export function canonicalizeAlbums(names: string[]): Map<string, string> {
  const byFold = new Map<string, string[]>()
  for (const name of names) {
    if (!name) continue
    const key = foldName(name)
    if (!key) continue
    const list = byFold.get(key)
    if (list) list.push(name)
    else byFold.set(key, [name])
  }

  // Shortest keys first, so a general form is always available as a merge target.
  const folds = [...byFold.keys()].sort((a, b) => a.length - b.length || a.localeCompare(b))

  const mergedInto = new Map<string, string>()
  const MIN_PREFIX = 5 // guards against absurd merges on very short names

  for (const fold of folds) {
    for (const candidate of folds) {
      if (candidate === fold) break // only consider strictly shorter/earlier keys
      if (candidate.length < MIN_PREFIX) continue
      if (fold.startsWith(candidate)) {
        mergedInto.set(fold, mergedInto.get(candidate) ?? candidate)
        break
      }
    }
  }

  // Gather every original spelling under its final target key.
  const groups = new Map<string, string[]>()
  for (const [fold, originals] of byFold) {
    const target = mergedInto.get(fold) ?? fold
    const list = groups.get(target)
    if (list) list.push(...originals)
    else groups.set(target, [...originals])
  }

  const display = new Map<string, string>()
  for (const [target, originals] of groups) {
    const counts = new Map<string, number>()
    for (const o of originals) counts.set(o, (counts.get(o) ?? 0) + 1)
    const best = [...counts.entries()].sort(
      (a, b) => b[1] - a[1] || a[0].length - b[0].length || a[0].localeCompare(b[0])
    )[0]![0]
    display.set(target, best)
  }

  const result = new Map<string, string>()
  for (const [fold, originals] of byFold) {
    const target = mergedInto.get(fold) ?? fold
    const canonical = display.get(target)!
    for (const o of originals) result.set(o, canonical)
  }
  return result
}

export interface TagLike {
  title: string
  album: string
  artist: string
  genre: string
}

/** Fills only the fields real tags left empty. Real metadata always wins. */
export function applyInference(path: string, tags: TagLike): TagLike {
  const needsAnything = !tags.title || !tags.album || !tags.artist || !tags.genre
  if (!needsAnything) return tags

  const guess = inferFromFilename(path)
  return {
    title: tags.title || guess.title,
    album: tags.album || guess.album,
    artist: tags.artist || guess.artist,
    genre: tags.genre || guess.genre
  }
}
