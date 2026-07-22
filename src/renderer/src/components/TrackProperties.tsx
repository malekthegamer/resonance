import type { Track } from '@shared/types'
import { formatBitrate, formatDuration, formatFileSize } from '../core/format'
import { AlbumArt } from './AlbumArt'
import { IconClose } from './Icons'
import styles from './TrackProperties.module.css'

interface Props {
  track: Track
  onClose(): void
}

function when(ms: number | null): string {
  if (!ms) return 'Never'
  return new Date(ms).toLocaleString()
}

/** Properties dialog reached from the track context menu. */
export function TrackProperties({ track, onClose }: Props): React.JSX.Element {
  const rows: Array<[string, string]> = [
    ['Title', track.title],
    ['Artist', track.artist || '—'],
    ['Album', track.album || '—'],
    ['Album artist', track.albumArtist || '—'],
    ['Genre', track.genre || '—'],
    ['Year', track.year ? String(track.year) : '—'],
    ['Track', track.trackNo ? String(track.trackNo) : '—'],
    ['Disc', track.discNo ? String(track.discNo) : '—'],
    ['Duration', formatDuration(track.duration)],
    ['Format', track.format.toUpperCase()],
    ['Codec', track.codec || '—'],
    ['Bitrate', formatBitrate(track.bitrate) || '—'],
    ['Sample rate', track.sampleRate ? `${track.sampleRate} Hz` : '—'],
    ['File size', formatFileSize(track.size) || '—'],
    ['Play count', String(track.playCount)],
    ['Last played', when(track.lastPlayed)],
    ['Added', when(track.dateAdded)],
    ['Status', track.available ? 'Available' : 'File missing'],
    ['Location', track.path]
  ]

  return (
    <div className={styles.backdrop} onClick={onClose} data-testid="properties-backdrop">
      <div
        className={styles.dialog}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Track properties"
        data-testid="properties"
      >
        <header className={styles.head}>
          <AlbumArt artRef={track.artRef} seed={track.album || track.title} size={56} radius={10} />
          <div className={styles.headText}>
            <h2 className={styles.title}>{track.title}</h2>
            <p className={styles.sub}>{track.artist || 'Unknown Artist'}</p>
          </div>
          <button className={styles.close} onClick={onClose} aria-label="Close">
            <IconClose size={15} />
          </button>
        </header>

        <dl className={styles.rows}>
          {rows.map(([label, value]) => (
            <div key={label} className={styles.row}>
              <dt>{label}</dt>
              {/* Paths and long titles must be selectable so they can be copied. */}
              <dd title={value}>{value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  )
}
