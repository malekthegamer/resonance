import { useEffect } from 'react'
import { usePlayer } from '../state/player'

/**
 * Connects the main window to the desktop shell.
 *
 * Two directions:
 *  - inbound: media keys and tray clicks arrive as commands and drive the player
 *  - outbound: every playback change is published so the tray tooltip and the
 *    mini-player stay in sync
 *
 * Only this window runs it, because only this window owns the audio graph.
 */
export function useDesktopIntegration(): void {
  const { toggle, next, previous, stop, setVolume } = usePlayer()

  useEffect(() => {
    return window.resonance.desktop.onMediaCommand((command) => {
      const state = usePlayer.getState()
      switch (command) {
        case 'playPause':
          void state.toggle()
          break
        case 'next':
          void state.next(false)
          break
        case 'previous':
          void state.previous()
          break
        case 'stop':
          state.stop()
          break
        case 'volumeUp':
          state.setVolume(Math.min(1, state.volume + 0.05))
          break
        case 'volumeDown':
          state.setVolume(Math.max(0, state.volume - 0.05))
          break
      }
    })
  }, [toggle, next, previous, stop, setVolume])

  // Publish state on every meaningful change. Subscribing to the store rather
  // than re-running an effect per render keeps this off the render path.
  useEffect(() => {
    let lastKey = ''
    const publish = (): void => {
      const s = usePlayer.getState()
      // Position changes constantly; only republish on a whole-second boundary
      // so the tray is not updated 60 times a second.
      const key = [
        s.current?.id ?? 0,
        s.playing,
        Math.floor(s.position),
        Math.floor(s.duration)
      ].join('|')
      if (key === lastKey) return
      lastKey = key

      window.resonance.desktop.publishNowPlaying({
        trackId: s.current?.id ?? null,
        title: s.current?.title ?? '',
        artist: s.current?.artist ?? '',
        album: s.current?.album ?? '',
        artRef: s.current?.artRef ?? null,
        playing: s.playing,
        positionSec: s.position,
        durationSec: s.duration
      })
    }

    const force = (): void => {
      lastKey = ''
      publish()
    }

    publish()
    const unsubscribeStore = usePlayer.subscribe(publish)
    const unsubscribeRequest = window.resonance.desktop.onNowPlayingRequest(force)
    return () => {
      unsubscribeStore()
      unsubscribeRequest()
    }
  }, [])
}
