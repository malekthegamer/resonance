import { useEffect, useMemo, useState } from 'react'
import type { Track } from '@shared/types'
import {
  changesFrom,
  commonTags,
  EMPTY_FORM,
  hasChanges,
  type FormValues,
  type MixedFlags,
  type TagField
} from '../core/tagForm'
import { fillFromFilename } from '../core/fillFromFilename'
import { AlbumArt } from './AlbumArt'
import { IconClose } from './Icons'
import styles from './TagEditor.module.css'

interface Props {
  tracks: Track[]
  onClose(): void
  /** Reports what happened so the caller can toast it and refresh the library. */
  onSaved(message: string): void
}

interface FieldSpec {
  key: TagField
  label: string
  numeric?: boolean
  /** Half-width, so year/track/disc share a row. */
  short?: boolean
}

const FIELDS: FieldSpec[] = [
  { key: 'title', label: 'Title' },
  { key: 'artist', label: 'Artist' },
  { key: 'album', label: 'Album' },
  { key: 'albumArtist', label: 'Album artist' },
  { key: 'genre', label: 'Genre' },
  { key: 'year', label: 'Year', numeric: true, short: true },
  { key: 'trackNo', label: 'Track', numeric: true, short: true },
  { key: 'discNo', label: 'Disc', numeric: true, short: true }
]

/**
 * Edits real tags in the files themselves.
 *
 * Multi-track editing is the reason this exists: tagging an album should be one
 * operation, not twelve. Fields the tracks disagree on show "(multiple values)"
 * and are left alone unless the user types into them — see core/tagForm.ts for
 * why that is tracked as "touched" rather than diffed.
 */
export function TagEditor({ tracks, onClose, onSaved }: Props): React.JSX.Element {
  const [values, setValues] = useState<FormValues>(EMPTY_FORM)
  const [mixed, setMixed] = useState<MixedFlags>(
    () => commonTags([]).mixed
  )
  const [touched, setTouched] = useState<Set<TagField>>(new Set())
  const [artwork, setArtwork] = useState<string | null | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [errors, setErrors] = useState<string[]>([])

  const ids = useMemo(() => tracks.map((t) => t.id), [tracks])
  const multiple = tracks.length > 1

  /*
   * Read from the files, not from the database rows. The database holds what
   * the last scan saw; the file is what is about to be overwritten, and editing
   * a stale view of it is how fields get clobbered.
   */
  useEffect(() => {
    let cancelled = false
    void window.resonance.tags.read(ids).then((results) => {
      if (cancelled) return
      const ok = results.filter((r) => r.ok && r.tags).map((r) => r.tags!)
      const { values: v, mixed: m } = commonTags(ok)
      setValues(v)
      setMixed(m)
      setErrors(results.filter((r) => !r.ok).map((r) => r.error ?? 'Could not read tags'))
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [ids])

  function edit(field: TagField, next: string): void {
    setValues((v) => ({ ...v, [field]: next }))
    setTouched((t) => (t.has(field) ? t : new Set(t).add(field)))
    // Once typed into, the field speaks for the whole selection.
    if (mixed[field]) setMixed((m) => ({ ...m, [field]: false }))
  }

  /**
   * Populates the form from the filename. **Writes nothing.**
   *
   * This is the same parser that was built, shipped and reverted for guessing
   * behind the user's back. It is acceptable here precisely because the result
   * lands in a form they read and confirm — see core/fillFromFilename.ts.
   */
  function fillFromNames(): void {
    if (tracks.length === 0) return
    const guesses = tracks.map((t) => fillFromFilename(t.path))
    const { values: v, mixed: m } = commonTags(guesses)

    const next = { ...values }
    const nextTouched = new Set(touched)
    const nextMixed = { ...mixed }

    for (const { key } of FIELDS) {
      const guess = v[key]
      // Only fill what the parser is actually confident about. Overwriting a
      // real tag with a blank guess would be worse than doing nothing.
      if (!guess || m[key]) continue
      next[key] = guess
      nextTouched.add(key)
      nextMixed[key] = false
    }

    setValues(next)
    setTouched(nextTouched)
    setMixed(nextMixed)
  }

  async function pickArtwork(): Promise<void> {
    const path = await window.resonance.tags.pickArtwork()
    if (path) setArtwork(path)
  }

  async function save(): Promise<void> {
    setBusy(true)
    try {
      const changes = changesFrom(values, touched)
      const report = await window.resonance.tags.write(ids, changes, artwork)

      const n = report.written
      const noun = n === 1 ? 'track' : 'tracks'
      if (report.failed > 0) {
        const first = report.results.find((r) => !r.ok)?.error ?? 'Unknown error'
        onSaved(`Tagged ${n} ${noun}, ${report.failed} failed: ${first}`)
      } else {
        onSaved(`Tagged ${n} ${noun}`)
      }
      onClose()
    } finally {
      setBusy(false)
    }
  }

  const dirty = hasChanges(values, touched) || artwork !== undefined
  const first = tracks[0]

  return (
    <div className={styles.backdrop} onClick={onClose} data-testid="tag-editor-backdrop">
      <div
        className={styles.dialog}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Edit tags"
        data-testid="tag-editor"
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose()
        }}
      >
        <header className={styles.head}>
          <AlbumArt
            artRef={first?.artRef ?? null}
            seed={first?.album || first?.title || 'tags'}
            size={56}
            radius={10}
          />
          <div className={styles.headText}>
            <h2 className={styles.title}>Edit tags</h2>
            <p className={styles.sub} data-testid="tag-editor-subject">
              {multiple ? `${tracks.length} tracks` : (first?.title ?? '')}
            </p>
          </div>
          <button className={styles.close} onClick={onClose} aria-label="Close">
            <IconClose size={15} />
          </button>
        </header>

        {/* Said plainly and up front: this rewrites the files on disk. */}
        <p className={styles.notice}>
          Writes real tags into your files. The original of each file is backed up once,
          before its first edit.
        </p>

        {errors.length > 0 && (
          <p className={styles.error} data-testid="tag-editor-error">
            {errors[0]}
          </p>
        )}

        <div className={styles.fields}>
          {FIELDS.map((f) => (
            <label
              key={f.key}
              className={`${styles.field} ${f.short ? styles.short : ''}`}
            >
              <span className={styles.label}>{f.label}</span>
              <input
                className={styles.input}
                value={values[f.key]}
                inputMode={f.numeric ? 'numeric' : undefined}
                placeholder={mixed[f.key] ? '(multiple values)' : ''}
                disabled={loading || busy}
                onChange={(e) => edit(f.key, e.target.value)}
                data-testid={`tag-${f.key}`}
                data-mixed={mixed[f.key] ? 'true' : undefined}
              />
            </label>
          ))}
        </div>

        <div className={styles.tools}>
          <button
            className={styles.tool}
            onClick={fillFromNames}
            disabled={loading || busy}
            data-testid="fill-from-filename"
            title="Suggest values from the filename. Nothing is saved until you press Save."
          >
            Fill from filename
          </button>
          <button
            className={styles.tool}
            onClick={() => void pickArtwork()}
            disabled={busy}
            data-testid="pick-artwork"
          >
            {artwork ? 'Cover art selected' : 'Choose cover art…'}
          </button>
          {artwork && (
            <button
              className={styles.tool}
              onClick={() => setArtwork(undefined)}
              data-testid="clear-artwork-choice"
            >
              Undo art choice
            </button>
          )}
        </div>

        <footer className={styles.foot}>
          <button className={styles.cancel} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            className={styles.save}
            onClick={() => void save()}
            disabled={!dirty || busy || loading}
            data-testid="tag-save"
          >
            {busy ? 'Saving…' : multiple ? `Save to ${tracks.length} tracks` : 'Save'}
          </button>
        </footer>
      </div>
    </div>
  )
}
