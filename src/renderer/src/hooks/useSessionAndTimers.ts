import { useEffect } from 'react'
import { hasExpired, SLEEP_OFF } from '../core/sleepTimer'
import { usePlayer } from '../state/player'

const SESSION_SAVE_INTERVAL_MS = 5000
const SLEEP_TICK_MS = 1000

/**
 * Restores the previous session on launch, keeps it saved while playing, and
 * runs the sleep timer.
 *
 * The session is saved on an interval rather than on every position update: the
 * position changes several times a second and each save is a disk write.
 */
export function useSessionAndTimers(): void {
  useEffect(() => {
    void usePlayer.getState().restoreSession()
  }, [])

  useEffect(() => {
    const id = window.setInterval(() => {
      const s = usePlayer.getState()
      // Save intentional empty queues too, but only after restoration finishes.
      if (s.sessionRestored) s.persistSession()
    }, SESSION_SAVE_INTERVAL_MS)

    // Also save when the window is closing, so the last few seconds are not lost.
    const onHide = (): void => {
      const s = usePlayer.getState()
      if (s.sessionRestored) s.persistSession()
    }
    window.addEventListener('pagehide', onHide)
    window.addEventListener('beforeunload', onHide)

    return () => {
      window.clearInterval(id)
      window.removeEventListener('pagehide', onHide)
      window.removeEventListener('beforeunload', onHide)
    }
  }, [])

  useEffect(() => {
    const id = window.setInterval(() => {
      const s = usePlayer.getState()
      if (hasExpired(s.sleep)) {
        s.stop()
        usePlayer.setState({ sleep: SLEEP_OFF })
      }
    }, SLEEP_TICK_MS)
    return () => window.clearInterval(id)
  }, [])
}
