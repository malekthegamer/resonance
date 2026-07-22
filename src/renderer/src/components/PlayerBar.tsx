import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { formatDuration } from '../core/format'
import { usePlayer } from '../state/player'
import { AlbumArt } from './AlbumArt'
import {
  IconEqualizer,
  IconNext,
  IconPrevious,
  IconQueue,
  IconRepeat,
  IconRepeatOne,
  IconShuffle,
  IconStop,
  IconVolume,
  IconVolumeMuted
} from './Icons'
import styles from './PlayerBar.module.css'

/** Draggable seek bar showing elapsed and buffered ranges. */
function ProgressBar(): React.JSX.Element {
  const { position, duration, buffered, seek } = usePlayer()
  const [dragging, setDragging] = useState(false)
  const [preview, setPreview] = useState(0)
  const barRef = useRef<HTMLDivElement>(null)

  const shown = dragging ? preview : position
  const pct = duration > 0 ? (shown / duration) * 100 : 0

  function fractionAt(clientX: number): number {
    const rect = barRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return 0
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
  }

  // Pointer capture keeps the drag alive when the cursor leaves the thin bar —
  // without it, dragging fast drops the seek halfway through.
  function onPointerDown(e: React.PointerEvent): void {
    if (duration <= 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    setDragging(true)
    setPreview(fractionAt(e.clientX) * duration)
  }

  function onPointerMove(e: React.PointerEvent): void {
    if (!dragging) return
    setPreview(fractionAt(e.clientX) * duration)
  }

  function onPointerUp(e: React.PointerEvent): void {
    if (!dragging) return
    e.currentTarget.releasePointerCapture(e.pointerId)
    setDragging(false)
    seek(fractionAt(e.clientX) * duration)
  }

  return (
    <div className={styles.progressRow}>
      <span className={styles.time} data-testid="position">
        {formatDuration(shown)}
      </span>
      <div
        ref={barRef}
        className={styles.progress}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        role="slider"
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(shown)}
        tabIndex={0}
        data-testid="seek"
      >
        <div className={styles.progressTrack}>
          {buffered.map(([start, end], i) => (
            <div
              key={i}
              className={styles.buffered}
              style={{
                left: `${duration > 0 ? (start / duration) * 100 : 0}%`,
                width: `${duration > 0 ? ((end - start) / duration) * 100 : 0}%`
              }}
            />
          ))}
          <div className={styles.progressFill} style={{ width: `${pct}%` }} />
          <div className={styles.knob} style={{ left: `${pct}%` }} />
        </div>
      </div>
      <span className={styles.time} data-testid="duration">
        {formatDuration(duration)}
      </span>
    </div>
  )
}

function PlayPauseIcon({ playing }: { playing: boolean }): React.JSX.Element {
  // Morphs between the two glyphs rather than swapping them, which is what makes
  // the button feel responsive rather than flickery.
  return (
    <svg viewBox="0 0 24 24" width="21" height="21" aria-hidden>
      <motion.path
        fill="currentColor"
        initial={false}
        animate={{ d: playing ? 'M7 5h3.6v14H7zM13.4 5H17v14h-3.6z' : 'M8 5l11 7-11 7V5z' }}
        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
      />
    </svg>
  )
}

interface Props {
  onOpenQueue(): void
  onOpenEq(): void
  onOpenNowPlaying(): void
}

export function PlayerBar({ onOpenQueue, onOpenEq, onOpenNowPlaying }: Props): React.JSX.Element {
  const {
    current, playing, volume, muted, queue, error,
    toggle, next, previous, stop, setVolume, toggleMute, toggleShuffle, cycleRepeat, clearError
  } = usePlayer()

  useEffect(() => {
    if (!error) return
    const t = window.setTimeout(clearError, 5000)
    return () => window.clearTimeout(t)
  }, [error, clearError])

  const repeatLabel =
    queue.repeat === 'one' ? 'Repeat one' : queue.repeat === 'all' ? 'Repeat all' : 'Repeat off'

  return (
    <footer className={styles.bar} data-testid="player-bar">
      {error && (
        <div className={styles.error} data-testid="player-error" role="alert">
          {error}
        </div>
      )}

      <div className={styles.inner}>
        <button
          className={styles.nowPlaying}
          onClick={onOpenNowPlaying}
          data-testid="open-now-playing"
          aria-label="Open now playing"
        >
          <AlbumArt
            artRef={current?.artRef ?? null}
            seed={current?.album || current?.title || 'Resonance'}
            size={52}
            radius={10}
          />
          <span className={styles.meta}>
            <span className={styles.title} data-testid="np-title">
              {current?.title ?? 'Nothing playing'}
            </span>
            <span className={styles.sub} data-testid="np-artist">
              {current ? current.artist || current.album || 'Unknown Artist' : 'Pick a track'}
            </span>
          </span>
        </button>

        <div className={styles.center}>
          <div className={styles.transport}>
            <button
              className={`${styles.ctl} ${queue.shuffle ? styles.on : ''}`}
              onClick={toggleShuffle}
              title="Shuffle"
              aria-label="Shuffle"
              aria-pressed={queue.shuffle}
              data-testid="shuffle"
            >
              <IconShuffle size={15} />
            </button>
            <button
              className={styles.ctl}
              onClick={() => void previous()}
              title="Previous"
              aria-label="Previous"
              data-testid="prev"
            >
              <IconPrevious size={16} />
            </button>

            <motion.button
              className={styles.play}
              onClick={() => void toggle()}
              whileTap={{ scale: 0.92 }}
              title={playing ? 'Pause' : 'Play'}
              aria-label={playing ? 'Pause' : 'Play'}
              data-testid="playpause"
            >
              <PlayPauseIcon playing={playing} />
            </motion.button>

            <button
              className={styles.ctl}
              onClick={() => void next(false)}
              title="Next"
              aria-label="Next"
              data-testid="next"
            >
              <IconNext size={16} />
            </button>
            <button
              className={`${styles.ctl} ${queue.repeat !== 'off' ? styles.on : ''}`}
              onClick={cycleRepeat}
              title={repeatLabel}
              aria-label={repeatLabel}
              data-testid="repeat"
            >
              {queue.repeat === 'one' ? <IconRepeatOne size={15} /> : <IconRepeat size={15} />}
            </button>
          </div>

          <ProgressBar />
        </div>

        <div className={styles.right}>
          <button
            className={styles.ctl}
            onClick={stop}
            title="Stop"
            aria-label="Stop"
            data-testid="stop"
          >
            <IconStop size={14} />
          </button>
          <button
            className={styles.ctl}
            onClick={onOpenEq}
            title="Equalizer"
            aria-label="Equalizer"
            data-testid="open-eq"
          >
            <IconEqualizer size={16} />
          </button>
          <button
            className={styles.ctl}
            onClick={onOpenQueue}
            title="Queue"
            aria-label="Queue"
            data-testid="open-queue"
          >
            <IconQueue size={16} />
          </button>

          <button
            className={styles.ctl}
            onClick={toggleMute}
            title={muted ? 'Unmute' : 'Mute'}
            aria-label={muted ? 'Unmute' : 'Mute'}
            data-testid="mute"
          >
            {muted || volume === 0 ? <IconVolumeMuted size={16} /> : <IconVolume size={16} />}
          </button>
          <input
            className={styles.volume}
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={muted ? 0 : volume}
            onChange={(e) => setVolume(Number(e.target.value))}
            aria-label="Volume"
            data-testid="volume"
          />
        </div>
      </div>
    </footer>
  )
}
