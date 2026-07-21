/**
 * Deterministic placeholder artwork.
 *
 * The target library has zero embedded cover art, so placeholders are the normal
 * case here, not the exception. A single generic icon would render the Albums
 * grid as an undifferentiated wall, so each album gets a stable gradient derived
 * from its own name — the same album always looks the same, and different albums
 * are visually distinguishable at a glance.
 *
 * Hues are constrained to 200°–330° (blue through purple to magenta) so the
 * grid still reads as one system alongside the fixed identity gradient, rather
 * than turning into a rainbow.
 */

const HUE_MIN = 200
const HUE_RANGE = 130

/** FNV-1a. Small, fast, and stable across runs — Math.random would not be. */
export function hashString(input: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

export interface PlaceholderColors {
  from: string
  to: string
  hue: number
}

export function placeholderColors(seed: string): PlaceholderColors {
  const h = hashString(seed || 'unknown')
  const hue = HUE_MIN + (h % HUE_RANGE)
  // Second stop offset around the wheel, wrapped back into the allowed band so
  // the gradient has movement without escaping the palette.
  const hue2 = HUE_MIN + ((h >>> 8) % HUE_RANGE)
  return {
    hue,
    from: `hsl(${hue} 62% 46%)`,
    to: `hsl(${hue2} 58% 30%)`
  }
}

export function placeholderGradient(seed: string): string {
  const { from, to } = placeholderColors(seed)
  return `linear-gradient(135deg, ${from} 0%, ${to} 100%)`
}

/**
 * Connector words are skipped when picking initials: "Attack on Titan" should
 * read AT, not AO.
 */
const STOP_WORDS = new Set([
  'a', 'an', 'and', 'the', 'of', 'on', 'in', 'to', 'for', 'no', 'wo', 'ni', 'de'
])

/** Up to two initials, used as the placeholder's glyph. */
export function initialsFor(name: string): string {
  const words = (name || '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)

  if (words.length === 0) return '♪'

  // Drop connectors only when doing so still leaves something to work with.
  const significant = words.filter((w) => !STOP_WORDS.has(w.toLowerCase()))
  const chosen = significant.length > 0 ? significant : words

  if (chosen.length === 1) return chosen[0]!.slice(0, 2).toUpperCase()
  return (chosen[0]![0]! + chosen[chosen.length - 1]![0]!).toUpperCase()
}

/** Builds the resonance-art:// URL for a stored art reference. */
export function artUrl(ref: string | null | undefined): string | null {
  if (!ref) return null
  return `resonance-art://art/${ref.replace(/\\/g, '/')}`
}
