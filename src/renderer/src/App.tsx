import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Theme, Track } from '@shared/types'
import type { ViewId } from './state/library'
import { TitleBar } from './components/TitleBar'
import { Sidebar } from './components/Sidebar'
import { TopBar } from './components/TopBar'
import { TrackTable } from './components/TrackTable'
import { AlbumGrid, SimpleGrid } from './components/CardGrid'
import { ScanBanner } from './components/ScanBanner'
import { PlayerBar } from './components/PlayerBar'
import { QueuePanel } from './components/QueuePanel'
import { EqualizerPanel } from './components/EqualizerPanel'
import { NowPlaying } from './components/NowPlaying'
import { SettingsPanel } from './components/SettingsPanel'
import { ContextMenu, type MenuItem } from './components/ContextMenu'
import { TrackProperties } from './components/TrackProperties'
import { Toast } from './components/Toast'
import { ConfirmDialog } from './components/ConfirmDialog'
import {
  albumKeyFor,
  artistKeyFor,
  genreKeyFor,
  groupByAlbum,
  groupByArtist,
  groupByGenre,
  recentlyAdded
} from './core/grouping'
import { sortTracks } from './core/sort'
import { useLibrary } from './state/library'
import { usePlayer } from './state/player'
import { usePlaylists } from './state/playlists'
import { useSelection } from './state/selection'
import { useEq } from './state/eq'
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts'
import { useDesktopIntegration } from './hooks/useDesktopIntegration'
import { useSessionAndTimers } from './hooks/useSessionAndTimers'
import styles from './App.module.css'

const VIEW_TITLES: Record<string, string> = {
  songs: 'Songs',
  albums: 'Albums',
  artists: 'Artists',
  genres: 'Genres',
  recent: 'Recently Added'
}

interface MenuState {
  x: number
  y: number
  items: MenuItem[]
}

export default function App(): React.JSX.Element {
  const [theme, setTheme] = useState<Theme>('dark')
  const [dragging, setDragging] = useState(false)
  const [panel, setPanel] = useState<'queue' | 'eq' | 'now' | 'settings' | null>(null)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [properties, setProperties] = useState<Track | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [renamingPlaylistId, setRenamingPlaylistId] = useState<number | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<{ id: number; name: string } | null>(null)
  const [showVisualizer, setShowVisualizer] = useState(true)

  const {
    tracks, view, focus, query, searchResults, sortKey, sortDir,
    load, setFocus, setView, setScan, scanPaths
  } = useLibrary()

  const playTracks = usePlayer((s) => s.playTracks)
  const initPlayer = usePlayer((s) => s.init)
  const currentTrack = usePlayer((s) => s.current)
  const playNextTracks = usePlayer((s) => s.playNext)
  const hydrateEq = useEq((s) => s.hydrate)
  const selection = useSelection((s) => s.selection)
  const contextMenuAt = useSelection((s) => s.contextMenuAt)
  const clearSelection = useSelection((s) => s.clear)
  const pruneSelection = useSelection((s) => s.prune)
  const selectedTracksOf = useSelection((s) => s.selectedTracks)
  const addToQueue = usePlayer((s) => s.addToQueue)
  useKeyboardShortcuts()
  useDesktopIntegration()
  useSessionAndTimers()

  const {
    playlists, openId: openPlaylistId, openTracks: playlistTracks, lastImport,
    open: openPlaylist, refresh: refreshPlaylists, addTracks: addToPlaylist,
    remove: removePlaylist, exportPlaylist,
    importFiles, removeAt: removeFromPlaylist, clearImportNotice
  } = usePlaylists()

  useEffect(() => {
    void load()
    initPlayer()
    void refreshPlaylists()
    void hydrateEq()
    void window.resonance.settings.getAll().then((s) => {
      setTheme(s.theme)
      setShowVisualizer(s.showVisualizer ?? true)
    })
    return window.resonance.library.onScanProgress(setScan)
  }, [load, setScan, initPlayer, refreshPlaylists, hydrateEq])

  useEffect(() => {
    document.documentElement.dataset['theme'] = theme
  }, [theme])

  // A rescan can remove tracks; a selection pointing at them would act on
  // nothing or, worse, on ids the database has since reused.
  useEffect(() => {
    pruneSelection(tracks.map((t) => t.id))
  }, [tracks, pruneSelection])

  // Surface import results, including partial matches — a playlist that imports
  // "successfully" with half its tracks missing must not look like a clean win.
  useEffect(() => {
    if (!lastImport) return
    setToast(
      lastImport.missing > 0
        ? `Imported ${lastImport.name}: ${lastImport.matched} tracks, ${lastImport.missing} not found in library`
        : `Imported ${lastImport.name}: ${lastImport.matched} tracks`
    )
    clearImportNotice()
  }, [lastImport, clearImportNotice])

  async function toggleTheme(): Promise<void> {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    await window.resonance.settings.set('theme', next)
  }

  const albums = useMemo(() => groupByAlbum(tracks), [tracks])
  const artists = useMemo(() => groupByArtist(tracks), [tracks])
  const genres = useMemo(() => groupByGenre(tracks), [tracks])

  const searching = searchResults !== null && query.trim().length > 0

  const visibleTracks = useMemo(() => {
    if (searching) return searchResults!
    if (openPlaylistId != null) return playlistTracks
    if (focus) {
      const inFocus = tracks.filter((t) => {
        if (focus.kind === 'album') return albumKeyFor(t) === focus.key
        if (focus.kind === 'artist') return artistKeyFor(t) === focus.key
        return genreKeyFor(t) === focus.key
      })
      return sortTracks(inFocus, focus.kind === 'album' ? 'trackNo' : sortKey, sortDir)
    }
    if (view === 'recent') return recentlyAdded(tracks)
    return sortTracks(tracks, sortKey, sortDir)
  }, [searching, searchResults, openPlaylistId, playlistTracks, focus, tracks, view, sortKey, sortDir])

  const play = useCallback(
    (list: Track[], index: number) => {
      void playTracks(list, index)
      const t = list[index]
      if (t) void window.resonance.tracks.recordPlay(t.id)
    },
    [playTracks]
  )

  /**
   * Selecting a library section must also close any open playlist. `showingGrid`
   * requires no playlist to be open, so without this, clicking "Albums" while a
   * playlist was open did nothing visible.
   */
  const navigateTo = useCallback(
    (next: ViewId) => {
      void openPlaylist(null)
      setView(next)
      // Selection must not survive navigation, or a bulk action would silently
      // apply to tracks that are no longer on screen.
      clearSelection()
      // The Now Playing screen replaces the whole content area, so leaving it
      // open would make the sidebar look unresponsive for a third time.
      setPanel((p) => (p === 'now' ? null : p))
    },
    [openPlaylist, setView, clearSelection]
  )

  const openPlaylistById = useCallback(
    (id: number) => {
      // Clear search and drill-down, or the playlist would be rendered behind
      // whatever the search was showing.
      setView('songs')
      setFocus(null)
      void openPlaylist(id)
      clearSelection()
      setPanel((p) => (p === 'now' ? null : p))
    },
    [openPlaylist, setFocus, setView, clearSelection]
  )

  /**
   * Menu for a right-clicked track.
   *
   * Acts on the whole selection when the clicked row is part of it, so "add
   * these 12 to a playlist" is one action. Labels carry the count, because a
   * menu that silently affects 12 tracks when you meant one is worse than a
   * verbose menu.
   */
  function trackMenuItems(track: Track, index: number, list: Track[]): MenuItem[] {
    const selected = selectedTracksOf(list)
    const targets = selected.length > 1 && selection.ids.has(track.id) ? selected : [track]
    const n = targets.length
    const suffix = n > 1 ? ` (${n} tracks)` : ''
    const ids = targets.map((t) => t.id)

    return [
      {
        label: n > 1 ? `Play ${n} tracks` : 'Play',
        onSelect: () => (n > 1 ? play(targets, 0) : play(list, index))
      },
      { label: `Play next${suffix}`, onSelect: () => playNextTracks(targets) },
      { label: `Add to queue${suffix}`, onSelect: () => addToQueue(targets) },
      { separator: true, label: '' },
      {
        label: `Add to playlist${suffix}`,
        submenu: playlists.map((pl) => ({
          label: pl.name,
          onSelect: () => void addToPlaylist(pl.id, ids)
        }))
      },
      ...(openPlaylistId != null
        ? [
            {
              label: `Remove from this playlist${suffix}`,
              danger: true,
              onSelect: () => void removeSelectedFromPlaylist(targets, list)
            } as MenuItem
          ]
        : []),
      { separator: true, label: '' },
      {
        label: 'Show in folder',
        // Only ever one file — opening 12 Explorer windows would be hostile.
        disabled: false,
        onSelect: () => void window.resonance.tracks.revealInFolder(track.id)
      },
      { label: 'Properties', onSelect: () => setProperties(track) }
    ]
  }

  /**
   * Removes tracks from the open playlist by position, highest first.
   * Removing by ascending position would shift the later entries out from under
   * each subsequent removal.
   */
  async function removeSelectedFromPlaylist(targets: Track[], list: Track[]): Promise<void> {
    const positions = targets
      .map((t) => list.findIndex((x) => x.id === t.id))
      .filter((i) => i >= 0)
      .sort((a, b) => b - a)
    for (const position of positions) await removeFromPlaylist(position)
    clearSelection()
  }

  function playlistMenuItems(id: number, name: string): MenuItem[] {
    return [
      {
        label: 'Play',
        onSelect: async () => {
          const list = await window.resonance.playlists.tracks(id)
          if (list.length) play(list, 0)
        }
      },
      {
        label: 'Add to queue',
        onSelect: async () => addToQueue(await window.resonance.playlists.tracks(id))
      },
      { separator: true, label: '' },
      {
        // Renames inline in the sidebar. window.prompt() was used here first and
        // silently threw — Electron does not implement it, so the menu item
        // appeared to do nothing at all.
        label: 'Rename…',
        onSelect: () => setRenamingPlaylistId(id)
      },
      {
        label: 'Export as M3U8…',
        onSelect: async () => {
          const saved = await exportPlaylist(id)
          if (saved) setToast(`Exported to ${saved}`)
        }
      },
      { separator: true, label: '' },
      {
        label: 'Delete playlist',
        danger: true,
        onSelect: () => setConfirmDelete({ id, name })
      }
    ]
  }

  async function onDrop(e: React.DragEvent): Promise<void> {
    e.preventDefault()
    setDragging(false)
    const paths = window.resonance.files.getPaths(Array.from(e.dataTransfer.files))
    if (paths.length === 0) return

    // A dropped playlist file is an import, not something to scan for audio.
    const playlistFiles = paths.filter((p) => /\.m3u8?$/i.test(p))
    const mediaPaths = paths.filter((p) => !/\.m3u8?$/i.test(p))
    if (playlistFiles.length) await importFiles(playlistFiles)
    if (mediaPaths.length) await scanPaths(mediaPaths)
  }

  const showingGrid =
    !searching && !focus && openPlaylistId == null && view !== 'songs' && view !== 'recent'

  const openPlaylistName = playlists.find((p) => p.id === openPlaylistId)?.name

  const title = searching
    ? `Search: “${query}”`
    : openPlaylistId != null
      ? (openPlaylistName ?? 'Playlist')
      : focus
        ? focus.label
        : (VIEW_TITLES[view] ?? 'Library')

  const subtitle =
    searching || focus || openPlaylistId != null
      ? `${visibleTracks.length} ${visibleTracks.length === 1 ? 'track' : 'tracks'}`
      : undefined

  function goBack(): void {
    if (openPlaylistId != null) void openPlaylist(null)
    else setFocus(null)
  }

  return (
    <div
      className={styles.shell}
      onDragOver={(e) => {
        e.preventDefault()
        if (!dragging) setDragging(true)
      }}
      onDragLeave={(e) => {
        // dragleave also fires when the pointer moves onto a child element, so
        // the overlay used to stick on permanently. Clearing only when the
        // pointer has actually left the window bounds is reliable.
        if (
          e.clientX <= 0 ||
          e.clientY <= 0 ||
          e.clientX >= window.innerWidth ||
          e.clientY >= window.innerHeight
        ) {
          setDragging(false)
        }
      }}
      onDrop={(e) => void onDrop(e)}
    >
      <TitleBar />

      <div className={styles.body}>
        <Sidebar
          onNavigate={navigateTo}
          onOpenPlaylist={openPlaylistById}
          onPlaylistContextMenu={(e, id, name) => {
            e.preventDefault()
            setMenu({ x: e.clientX, y: e.clientY, items: playlistMenuItems(id, name) })
          }}
          openPlaylistId={openPlaylistId}
          renamingId={renamingPlaylistId}
          onRenamingChange={setRenamingPlaylistId}
        />

        <main className={styles.content}>
          {panel === 'now' ? (
            <NowPlaying
              onClose={() => setPanel(null)}
              showVisualizer={showVisualizer}
              onToggleVisualizer={() => {
                const next = !showVisualizer
                setShowVisualizer(next)
                void window.resonance.settings.set('showVisualizer', next)
              }}
            />
          ) : (
          <>
          <TopBar
            title={title}
            subtitle={subtitle}
            onBack={focus || openPlaylistId != null ? goBack : undefined}
            theme={theme}
            onToggleTheme={() => void toggleTheme()}
          />
          <ScanBanner />

          {showingGrid ? (
            view === 'albums' ? (
              <AlbumGrid
                albums={albums}
                onOpen={(a) => setFocus({ kind: 'album', key: a.key, label: a.album })}
              />
            ) : view === 'artists' ? (
              <SimpleGrid
                groups={artists}
                kind="artist"
                onOpen={(g) => setFocus({ kind: 'artist', key: g.key, label: g.name })}
              />
            ) : (
              <SimpleGrid
                groups={genres}
                kind="genre"
                onOpen={(g) => setFocus({ kind: 'genre', key: g.key, label: g.name })}
              />
            )
          ) : (
            <TrackTable
              tracks={visibleTracks}
              showArt={!focus || focus.kind !== 'album'}
              onPlay={play}
              currentTrackId={currentTrack?.id ?? null}
              onContextMenu={(e, track, index) => {
                e.preventDefault()
                // Selects the row unless it is already part of the selection.
                contextMenuAt(track.id)
                setMenu({
                  x: e.clientX,
                  y: e.clientY,
                  items: trackMenuItems(track, index, visibleTracks)
                })
              }}
            />
          )}
          </>
          )}
        </main>

        {panel === 'queue' && <QueuePanel onClose={() => setPanel(null)} />}
        {panel === 'eq' && <EqualizerPanel onClose={() => setPanel(null)} />}
        {panel === 'settings' && (
          <SettingsPanel
            onClose={() => setPanel(null)}
            onSettingsChanged={(changed) => {
              if (typeof changed.showVisualizer === 'boolean') {
                setShowVisualizer(changed.showVisualizer)
              }
              // Crossfade must reach the live audio graph, not just settings.
              if (typeof changed.crossfadeSec === 'number') {
                usePlayer.getState().setCrossfade(changed.crossfadeSec)
              }
            }}
          />
        )}
      </div>

      <PlayerBar
        onOpenQueue={() => setPanel(panel === 'queue' ? null : 'queue')}
        onOpenEq={() => setPanel(panel === 'eq' ? null : 'eq')}
        onOpenNowPlaying={() => setPanel(panel === 'now' ? null : 'now')}
        onOpenSettings={() => setPanel(panel === 'settings' ? null : 'settings')}
        onToggleMiniPlayer={() => void window.resonance.desktop.toggleMiniPlayer()}
      />

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />
      )}
      {properties && (
        <TrackProperties track={properties} onClose={() => setProperties(null)} />
      )}
      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
      {confirmDelete && (
        <ConfirmDialog
          title="Delete playlist?"
          body={`“${confirmDelete.name}” will be removed. The tracks themselves stay in your library.`}
          confirmLabel="Delete"
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => {
            void removePlaylist(confirmDelete.id)
            setConfirmDelete(null)
          }}
        />
      )}

      {dragging && (
        <div className={styles.dropOverlay} data-testid="drop-overlay">
          <div className={styles.dropCard}>
            <p className={styles.dropTitle}>Drop to add</p>
            <p className={styles.dropBody}>Music files, folders, or .m3u playlists.</p>
          </div>
        </div>
      )}
    </div>
  )
}
