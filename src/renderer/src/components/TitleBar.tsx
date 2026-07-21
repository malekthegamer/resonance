import { useEffect, useState } from 'react'
import styles from './TitleBar.module.css'

/**
 * Custom window chrome for the frameless main window (plan §A1).
 *
 * Double-clicking the drag region toggles maximize — the OS normally provides
 * this and a frameless window does not, so it is implemented here. Drag-to-top
 * maximize is handled in the main process, which is the only place that can see
 * where the window was released.
 */
export function TitleBar(): React.JSX.Element {
  const [isMaximized, setIsMaximized] = useState(false)

  useEffect(() => {
    void window.resonance.window.isMaximized().then(setIsMaximized)
    // Returns an unsubscribe; without it this leaks a listener per remount.
    return window.resonance.window.onMaximizeChanged(setIsMaximized)
  }, [])

  return (
    <header
      className={styles.bar}
      onDoubleClick={() => window.resonance.window.toggleMaximize()}
    >
      <div className={styles.mark} aria-hidden />
      <span className={styles.title}>Resonance</span>
      <div className={styles.spacer} />

      <div className={styles.controls}>
        <button
          className={styles.ctl}
          onClick={() => window.resonance.window.minimize()}
          aria-label="Minimize"
          title="Minimize"
        >
          <svg viewBox="0 0 10 10" aria-hidden>
            <path d="M0 5h10" stroke="currentColor" strokeWidth="1.1" fill="none" />
          </svg>
        </button>

        <button
          className={styles.ctl}
          onClick={() => window.resonance.window.toggleMaximize()}
          aria-label={isMaximized ? 'Restore' : 'Maximize'}
          title={isMaximized ? 'Restore' : 'Maximize'}
        >
          {isMaximized ? (
            <svg viewBox="0 0 10 10" aria-hidden>
              <path
                d="M2.5 2.5V0.6h6.9v6.9H7.5M0.6 2.5h6.9v6.9H0.6z"
                stroke="currentColor"
                strokeWidth="1.1"
                fill="none"
              />
            </svg>
          ) : (
            <svg viewBox="0 0 10 10" aria-hidden>
              <rect
                x="0.6"
                y="0.6"
                width="8.8"
                height="8.8"
                stroke="currentColor"
                strokeWidth="1.1"
                fill="none"
              />
            </svg>
          )}
        </button>

        <button
          className={`${styles.ctl} ${styles.close}`}
          onClick={() => window.resonance.window.close()}
          aria-label="Close"
          title="Close"
        >
          <svg viewBox="0 0 10 10" aria-hidden>
            <path d="M0 0l10 10M10 0L0 10" stroke="currentColor" strokeWidth="1.1" fill="none" />
          </svg>
        </button>
      </div>
    </header>
  )
}
