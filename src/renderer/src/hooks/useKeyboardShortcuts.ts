import { useEffect } from 'react'
import { usePlayer } from '../state/player'

const SEEK_STEP_SEC = 5
const VOLUME_STEP = 0.05

/** True when the user is typing, so shortcuts must not hijack the keystroke. */
function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

/** In-app keyboard shortcuts (spec: Space, arrows; Ctrl+F is handled in TopBar). */
export function useKeyboardShortcuts(): void {
  const { toggle, next, previous, seek, setVolume, position, volume, toggleMute } = usePlayer()

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (isTyping(e.target)) return
      if (e.ctrlKey || e.metaKey || e.altKey) return

      switch (e.key) {
        case ' ':
          e.preventDefault()
          void toggle()
          break
        case 'ArrowRight':
          e.preventDefault()
          seek(position + SEEK_STEP_SEC)
          break
        case 'ArrowLeft':
          e.preventDefault()
          seek(Math.max(0, position - SEEK_STEP_SEC))
          break
        case 'ArrowUp':
          e.preventDefault()
          setVolume(Math.min(1, volume + VOLUME_STEP))
          break
        case 'ArrowDown':
          e.preventDefault()
          setVolume(Math.max(0, volume - VOLUME_STEP))
          break
        case 'm':
        case 'M':
          toggleMute()
          break
        case 'n':
        case 'N':
          void next(false)
          break
        case 'p':
        case 'P':
          void previous()
          break
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggle, next, previous, seek, setVolume, position, volume, toggleMute])
}
