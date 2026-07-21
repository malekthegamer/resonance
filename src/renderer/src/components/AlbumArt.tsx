import { useState } from 'react'
import { artUrl, initialsFor, placeholderGradient } from '../core/art'
import styles from './AlbumArt.module.css'

interface Props {
  artRef: string | null | undefined
  /** Seed for the placeholder — album name, or artist for artist tiles. */
  seed: string
  size?: number
  radius?: number
  className?: string
}

/**
 * Album artwork with a deterministic gradient fallback.
 *
 * Falls back on both "no art reference" and "art failed to load" — a cache entry
 * can be deleted out from under the database, and an <img> that 404s would
 * otherwise render as a broken-image glyph.
 */
export function AlbumArt({ artRef, seed, size = 44, radius = 8, className }: Props): React.JSX.Element {
  const [failed, setFailed] = useState(false)
  const url = artUrl(artRef)
  const showArt = url && !failed

  return (
    <div
      className={`${styles.wrap} ${className ?? ''}`}
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: showArt ? undefined : placeholderGradient(seed)
      }}
    >
      {showArt ? (
        <img
          className={styles.img}
          src={url}
          alt=""
          loading="lazy"
          draggable={false}
          onError={() => setFailed(true)}
        />
      ) : (
        <span className={styles.initials} style={{ fontSize: Math.max(10, size * 0.32) }}>
          {initialsFor(seed)}
        </span>
      )}
    </div>
  )
}
