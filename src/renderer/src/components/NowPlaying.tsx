import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { auroraFromImage, artUrl, initialsFor, placeholderGradient, type AuroraColors } from '../core/art'
import { formatDuration } from '../core/format'
import { usePlayer } from '../state/player'
import { Visualizer } from './Visualizer'
import { IconClose } from './Icons'
import styles from './NowPlaying.module.css'

interface Props {
  onClose(): void
  showVisualizer: boolean
  onToggleVisualizer(): void
}

export function NowPlaying({
  onClose,
  showVisualizer,
  onToggleVisualizer
}: Props): React.JSX.Element {
  const { current, position, duration, queue } = usePlayer()
  const [aurora, setAurora] = useState<AuroraColors | null>(null)
  const imgRef = useRef<HTMLImageElement>(null)

  const url = artUrl(current?.artRef)
  const seed = current?.album || current?.title || 'Resonance'

  // Reset when the track changes so a previous cover's wash never lingers
  // behind new artwork.
  useEffect(() => {
    setAurora(null)
  }, [current?.id])

  function onArtLoad(): void {
    if (imgRef.current) setAurora(auroraFromImage(imgRef.current))
  }

  /*
   * The wash is the ONLY art-derived colour in the app, and it is confined to
   * this screen. When there is no artwork — or the sample fails — it falls back
   * to the fixed identity gradient rather than guessing (plan §A4).
   */
  const washStyle = aurora
    ? {
        background: `radial-gradient(120% 90% at 50% 0%, ${aurora.from} 0%, transparent 62%),
                     radial-gradient(100% 80% at 20% 100%, ${aurora.to} 0%, transparent 60%)`
      }
    : undefined

  return (
    <div className={styles.screen} data-testid="now-playing">
      <div
        className={`${styles.wash} ${aurora ? '' : styles.washFallback}`}
        style={washStyle}
        data-testid="aurora-wash"
        aria-hidden
      />

      <button className={styles.close} onClick={onClose} aria-label="Close now playing">
        <IconClose size={16} />
      </button>

      <div className={styles.content}>
        <AnimatePresence mode="wait">
          <motion.div
            key={current?.id ?? 'none'}
            className={styles.artWrap}
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.99 }}
            transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
          >
            {url ? (
              <img
                ref={imgRef}
                className={styles.art}
                src={url}
                alt=""
                crossOrigin="anonymous"
                onLoad={onArtLoad}
                data-testid="np-art"
              />
            ) : (
              <div
                className={styles.artPlaceholder}
                style={{ background: placeholderGradient(seed) }}
                data-testid="np-art-placeholder"
              >
                <span>{initialsFor(seed)}</span>
              </div>
            )}
          </motion.div>
        </AnimatePresence>

        <div className={styles.meta}>
          <h1 className={styles.title} data-testid="np-screen-title">
            {current?.title ?? 'Nothing playing'}
          </h1>
          <p className={styles.artist}>{current?.artist || 'Unknown Artist'}</p>
          <p className={styles.album}>
            {current?.album || '—'}
            {current?.year ? ` · ${current.year}` : ''}
          </p>

          <div className={styles.progress}>
            <span>{formatDuration(position)}</span>
            <div className={styles.track}>
              <div
                className={styles.fill}
                style={{ width: `${duration > 0 ? (position / duration) * 100 : 0}%` }}
              />
            </div>
            <span>{formatDuration(duration)}</span>
          </div>

          <p className={styles.queueInfo}>
            Track {queue.index + 1} of {queue.items.length}
            {queue.shuffle ? ' · shuffled' : ''}
            {queue.repeat !== 'off' ? ` · repeat ${queue.repeat}` : ''}
          </p>
        </div>
      </div>

      <div className={styles.visualizerRow}>
        {showVisualizer && (
          <Visualizer className={styles.visualizer} active={showVisualizer} />
        )}
        <button
          className={styles.vizToggle}
          onClick={onToggleVisualizer}
          data-testid="toggle-visualizer"
        >
          {showVisualizer ? 'Hide visualizer' : 'Show visualizer'}
        </button>
      </div>
    </div>
  )
}
