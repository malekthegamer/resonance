import type { TagValues } from '../../../main/tags'

/**
 * Form arithmetic for the tag editor, kept pure because getting it wrong
 * silently blanks fields across a whole selection.
 *
 * Two rules do all the work:
 *
 *   1. A field the user did not touch is never written. Not "written with its
 *      old value" — omitted entirely. That is what makes editing twelve tracks
 *      at once safe: setting the album on twelve files must not also stamp the
 *      first file's title onto the other eleven.
 *   2. A field that differs across the selection shows as mixed and stays that
 *      way until the user types something.
 *
 * Rule 1 is why the form tracks *touched* fields rather than diffing against the
 * initial values. Diffing cannot tell "the user retyped the same thing" from
 * "the user never looked at it", and for a mixed field there is no single
 * initial value to diff against in the first place.
 */

export const TAG_FIELDS = [
  'title',
  'artist',
  'album',
  'albumArtist',
  'genre',
  'year',
  'trackNo',
  'discNo'
] as const

export type TagField = (typeof TAG_FIELDS)[number]

/** Fields the user types numbers into. Empty means "clear it". */
const NUMERIC: ReadonlySet<TagField> = new Set(['year', 'trackNo', 'discNo'])

export type FormValues = Record<TagField, string>
export type MixedFlags = Record<TagField, boolean>

export const EMPTY_FORM: FormValues = {
  title: '',
  artist: '',
  album: '',
  albumArtist: '',
  genre: '',
  year: '',
  trackNo: '',
  discNo: ''
}

type SourceTags = Partial<Record<TagField, string | number>>

function asText(value: string | number | undefined): string {
  if (value === undefined || value === null) return ''
  // 0 is how the reader reports "no year" / "no track number"; showing it as
  // "0" would invite the user to save a literal zero.
  if (typeof value === 'number') return value === 0 ? '' : String(value)
  return value
}

/**
 * Collapses several tracks' tags into one form.
 *
 * A field every track agrees on shows its value; anything else is mixed and
 * shows a placeholder instead of one arbitrary track's value — which would
 * otherwise look like the answer for all of them.
 */
export function commonTags(tracks: readonly SourceTags[]): {
  values: FormValues
  mixed: MixedFlags
} {
  const values = { ...EMPTY_FORM }
  const mixed = Object.fromEntries(TAG_FIELDS.map((f) => [f, false])) as MixedFlags
  if (tracks.length === 0) return { values, mixed }

  for (const field of TAG_FIELDS) {
    const first = asText(tracks[0]![field])
    const allAgree = tracks.every((t) => asText(t[field]) === first)
    if (allAgree) values[field] = first
    else mixed[field] = true
  }
  return { values, mixed }
}

/**
 * Builds the change set to send, from the fields the user actually edited.
 *
 * An empty string is a deliberate "clear this field" — the user selected the
 * text and deleted it — so it survives into the change set rather than being
 * treated as "no input".
 */
export function changesFrom(
  values: FormValues,
  touched: ReadonlySet<TagField>
): TagValues {
  const changes: TagValues = {}

  for (const field of TAG_FIELDS) {
    if (!touched.has(field)) continue
    const raw = values[field].trim()

    if (NUMERIC.has(field)) {
      const n = raw === '' ? 0 : Number.parseInt(raw, 10)
      // Garbage in a number box is dropped rather than written as 0, which
      // would silently erase a year the user was mid-way through retyping.
      if (Number.isNaN(n) || n < 0) continue
      changes[field as 'year' | 'trackNo' | 'discNo'] = n
    } else {
      changes[field as 'title' | 'artist' | 'album' | 'albumArtist' | 'genre'] = raw
    }
  }

  return changes
}

/** True when saving would do nothing, so the button can say so. */
export function hasChanges(values: FormValues, touched: ReadonlySet<TagField>): boolean {
  return Object.keys(changesFrom(values, touched)).length > 0
}
