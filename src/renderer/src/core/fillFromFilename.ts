/**
 * Guesses tag values from a filename, for the **"Fill from filename" button
 * only**.
 *
 * This is a restoration of the parser removed in `cd9a5a1`, and the distinction
 * from that version is the entire point. That code ran automatically during
 * scanning and wrote its guesses into the database, so the library quietly
 * filled with plausible, unverifiable structure the user had never seen or
 * agreed to. It was reverted at their request.
 *
 * Here the same logic only ever populates a form the user is looking at.
 * Nothing reaches a file until they read it and press Save. A suggestion the
 * user reviews is the opposite of an invention made behind their back — so the
 * parser is free to guess, and free to be wrong.
 *
 * Pure and DOM-free, so the fiddly regex work is unit-testable.
 */

export interface FilenameGuess {
  title: string
  album: string
  artist: string
  genre: string
  /** Which rule fired. Surfaced in the UI so a guess can be judged. */
  source: 'episode-marker' | 'by-artist' | 'dash' | 'filename-only'
}

/**
 * Rip and encode noise that carries no meaning. Stripped before parsing so it
 * cannot end up inside a suggested title.
 */
const NOISE = [
  // No trailing \b: these appear glued to the next word in real filenames
  // ("CreditlessDeath Note", "LyricsRe Zero"), where a word boundary never
  // matches and the noise survives into the suggested album name.
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
 * Always returns a usable title. Album, artist and genre come back empty when
 * nothing reliable could be determined — suggesting an artist from a filename
 * that does not name one is worse than leaving the field blank, because the
 * user has to notice it is wrong to reject it.
 */
export function fillFromFilename(path: string): FilenameGuess {
  const raw = clean(baseName(path))

  let album = ''
  let genre = ''
  let artist = ''
  let title = raw
  let source: FilenameGuess['source'] = 'filename-only'

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
      const deduped = clean(
        after.replace(/^\s*(op|ed|opening|ending)\b\s*#?\s*\d*\s*[-–—:]?\s*/i, '')
      )
      title = deduped || after
      genre = 'Anime'
      source = 'episode-marker'
    }
  }

  const by = title.match(BY_ARTIST)
  if (by?.[1]) {
    const candidate = clean(by[1])
    // Guard against titles that legitimately contain the word "by".
    if (candidate && candidate.split(/\s+/).length <= 4) {
      artist = candidate
      title = clean(title.slice(0, by.index))
      if (source === 'filename-only') source = 'by-artist'
    }
  }

  // "Artist - Title", the other common convention.
  //
  // Skipped when the right-hand side looks like an episode marker. Without that
  // guard "Re Zero - Ending 2" yields artist "Re Zero" — a series name
  // masquerading as a performer. When in doubt, suggest nothing.
  if (!album && !artist) {
    const dash = raw.match(/^(.{2,40}?)\s+[-–—]\s+(.+)$/)
    const rhsIsMarker = dash?.[2] ? /^(op|ed|opening|ending|theme)\b/i.test(dash[2].trim()) : false
    if (dash?.[1] && dash[2] && !rhsIsMarker) {
      artist = clean(dash[1])
      title = clean(dash[2])
      source = 'dash'
    }
  }

  // A filename of pure noise must still yield something showable, or the form
  // fills with a blank the user cannot tell apart from "no suggestion".
  const finalTitle = title || raw || baseName(path).trim() || 'Untitled'
  return { title: finalTitle, album, artist, genre, source }
}
