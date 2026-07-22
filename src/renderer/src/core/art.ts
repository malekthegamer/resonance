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

/**
 * Extracts a clamped dominant-colour pair from artwork, for the Now Playing
 * aurora wash (plan §A4).
 *
 * Saturation and lightness are clamped hard. A vivid red cover would otherwise
 * flood the frame and fight the fixed blue→purple identity; the aurora is meant
 * to be a hint of the artwork behind the art, not a repaint of the app. This is
 * also confined to Now Playing — it never touches the sidebar, player bar, or
 * global background.
 */
export interface AuroraColors {
  from: string
  to: string
}

const AURORA_MAX_SATURATION = 0.55
const AURORA_LIGHTNESS_MIN = 0.28
const AURORA_LIGHTNESS_MAX = 0.55

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]

  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6
  else if (max === gn) h = ((bn - rn) / d + 2) / 6
  else h = ((rn - gn) / d + 4) / 6
  return [h * 360, s, l]
}

/**
 * Samples a already-loaded image element. Returns null when the image cannot be
 * read — a tainted canvas throws, and the caller must fall back to the identity
 * gradient rather than showing nothing.
 */
export function auroraFromImage(img: HTMLImageElement): AuroraColors | null {
  try {
    const size = 24 // Downsampled: exact pixels do not matter, the average does.
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    ctx.drawImage(img, 0, 0, size, size)
    const { data } = ctx.getImageData(0, 0, size, size)

    let rSum = 0
    let gSum = 0
    let bSum = 0
    let count = 0
    let bestSat = -1
    let accent: [number, number, number] = [0, 0, 0]

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i]!
      const g = data[i + 1]!
      const b = data[i + 2]!
      const a = data[i + 3]!
      if (a < 128) continue

      rSum += r
      gSum += g
      bSum += b
      count++

      const [, s, l] = rgbToHsl(r, g, b)
      // Ignore near-black and near-white when picking the accent; they carry no
      // usable hue and would drag the wash toward grey.
      if (l > 0.2 && l < 0.85 && s > bestSat) {
        bestSat = s
        accent = [r, g, b]
      }
    }

    if (count === 0) return null

    const avg = rgbToHsl(rSum / count, gSum / count, bSum / count)
    const acc = bestSat >= 0 ? rgbToHsl(accent[0], accent[1], accent[2]) : avg

    const clamp = (hsl: [number, number, number]): string => {
      const h = Math.round(hsl[0])
      const s = Math.round(Math.min(hsl[1], AURORA_MAX_SATURATION) * 100)
      const l = Math.round(
        Math.min(AURORA_LIGHTNESS_MAX, Math.max(AURORA_LIGHTNESS_MIN, hsl[2])) * 100
      )
      return `hsl(${h} ${s}% ${l}%)`
    }

    return { from: clamp(acc), to: clamp(avg) }
  } catch {
    // Cross-origin taint or a zero-size image.
    return null
  }
}

/** Builds the resonance-art:// URL for a stored art reference. */
export function artUrl(ref: string | null | undefined): string | null {
  if (!ref) return null
  return `resonance-art://art/${ref.replace(/\\/g, '/')}`
}
