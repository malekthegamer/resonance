import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import type { NowPlayingState, Theme } from '@shared/types'
import { AlbumArt } from './components/AlbumArt'
import { IconClose, IconMiniPlayer, IconNext, IconPrevious } from './components/Icons'
import { formatDuration } from './core/format'
import styles from './MiniPlayer.module.css'

/**
 * Compact always-on-top remote control.
 *
 * Owns NO audio. It renders state pushed from the main window and sends commands
 * back through main. Giving it its own AudioContext would cause genuine double
 * playback.
 */
export default function MiniPlayer(): React.JSX.Element {
  const [state, setState] = useState<NowPlayingState | null>(null)

  useEffect(() => {
    void window.resonance.settings.getAll().then((s) => {
      document.documentElement.dataset['theme'] = (s.theme ?? 'dark') as Theme
    })
    return window.resonance.desktop.onNowPlaying(setState)
  }, [])

  const send = window.resonance.desktop.sendMediaCommand
  const progress =
    state && state.durationSec > 0 ? (state.positionSec / state.durationSec) * 100 : 0

  return (
    <div className={styles.mini} data-testid="mini-player">
      <div className={styles.dragRegion} />

      <AlbumArt
        artRef={state?.artRef ?? null}
        seed={state?.album || state?.title || 'Resonance'}
        size={62}
        radius={10}
      />

      <div className={styles.body}>
        <div className={styles.meta}>
          <span className={styles.title} title={state?.title} data-testid="mini-title">
            {state?.title ?? 'Nothing playing'}
          </span>
          <span className={styles.artist}>{state?.artist || state?.album || '—'}</span>
        </div>

        <div className={styles.progressRow}>
          <span className={styles.time}>{formatDuration(state?.positionSec ?? 0)}</span>
          <div className={styles.track}>
            <div className={styles.fill} style={{ width: `${progress}%` }} />
          </div>
          <span className={styles.time}>{formatDuration(state?.durationSec ?? 0)}</span>
        </div>

        <div className={styles.controls}>
          <button
            className={styles.ctl}
            onClick={() => send('previous')}
            aria-label="Previous"
            data-testid="mini-prev"
          >
            <IconPrevious size={15} />
          </button>

          <motion.button
            className={styles.play}
            onClick={() => send('playPause')}
            whileTap={{ scale: 0.92 }}
            aria-label={state?.playing ? 'Pause' : 'Play'}
            data-testid="mini-playpause"
          >
            <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden>
              <motion.path
                fill="currentColor"
                initial={false}
                animate={{
                  d: state?.playing ? 'M7 5h3.6v14H7zM13.4 5H17v14h-3.6z' : 'M8 5l11 7-11 7V5z'
                }}
                transition={{ duration: 0.2 }}
              />
            </svg>
          </motion.button>

          <button
            className={styles.ctl}
            onClick={() => send('next')}
            aria-label="Next"
            data-testid="mini-next"
          >
            <IconNext size={15} />
          </button>

          <div className={styles.spacer} />

          <button
            className={styles.ctl}
            onClick={() => window.resonance.desktop.closeMiniPlayer()}
            title="Back to full window"
            aria-label="Back to full window"
            data-testid="mini-restore"
          >
            <IconMiniPlayer size={15} />
          </button>
          <button
            className={styles.ctl}
            onClick={() => window.resonance.window.close()}
            title="Close"
            aria-label="Close"
          >
            <IconClose size={14} />
          </button>
        </div>
      </div>
    </div>
  )
}
