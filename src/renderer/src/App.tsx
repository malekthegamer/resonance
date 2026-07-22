import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Theme, Track } from '@shared/types'
import { TitleBar } from './components/TitleBar'
import { Sidebar } from './components/Sidebar'
import { TopBar } from './components/TopBar'
import { TrackTable } from './components/TrackTable'
import { AlbumGrid, SimpleGrid } from './components/CardGrid'
import { ScanBanner } from './components/ScanBanner'
import { PlayerBar } from './components/PlayerBar'
import { QueuePanel } from './components/QueuePanel'
import { ContextMenu, type MenuItem } from './components/ContextMenu'
import { TrackProperties } from './components/TrackProperties'
import { Toast } from './components/Toast'
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
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts'
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
  const [panel, setPanel] = useState<'queue' | 'eq' | 'now' | null>(null)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [properties, setProperties] = useState<Track | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const {
    tracks, view, focus, query, searchResults, sortKey, sortDir,
    load, setFocus, setView, setScan, scanPaths
  } = useLibrary()

  const playTracks = usePlayer((s) => s.playTracks)
  const initPlayer = usePlayer((s) => s.init)
  const currentTrack = usePlayer((s) => s.current)
  const playNextTracks = usePlayer((s) => s.playNext)
  const addToQueue = usePlayer((s) => s.addToQueue)
  useKeyboardShortcuts()

  const {
    playlists, openId: openPlaylistId, openTracks: playlistTracks, lastImport,
    open: openPlaylist, refresh: refreshPlaylists, addTracks: addToPlaylist,
    remove: removePlaylist, rename: renamePlaylist, exportPlaylist,
    importFiles, removeAt: removeFromPlaylist, clearImportNotice
  } = usePlaylists()

  useEffect(() => {
    void load()
    initPlayer()
    void refreshPlaylists()
    void window.resonance.settings.getAll().then((s) => setTheme(s.theme))
    return window.resonance.library.onScanProgress(setScan)
  }, [load, setScan, initPlayer, refreshPlaylists])

  useEffect(() => {
    document.documentElement.dataset['theme'] = theme
  }, [theme])

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

  const openPlaylistById = useCallback(
    (id: number) => {
      setView('songs')
      setFocus(null)
      void openPlaylist(id)
    },
    [openPlaylist, setFocus, setView]
  )

  function trackMenuItems(track: Track, index: number, list: Track[]): MenuItem[] {
    return [
      { label: 'Play', onSelect: () => play(list, index) },
      { label: 'Play next', onSelect: () => playNextTracks([track]) },
      { label: 'Add to queue', onSelect: () => addToQueue([track]) },
      { separator: true, label: '' },
      {
        label: 'Add to playlist',
        submenu: playlists.map((pl) => ({
          label: pl.name,
          onSelect: () => void addToPlaylist(pl.id, [track.id])
        }))
      },
      ...(openPlaylistId != null
        ? [
            {
              label: 'Remove from this playlist',
              danger: true,
              onSelect: () => void removeFromPlaylist(index)
            } as MenuItem
          ]
        : []),
      { separator: true, label: '' },
      {
        label: 'Show in folder',
        onSelect: () => void window.resonance.tracks.revealInFolder(track.id)
      },
      { label: 'Properties', onSelect: () => setProperties(track) }
    ]
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
        label: 'Rename…',
        onSelect: () => {
          const next = window.prompt('Rename playlist', name)
          if (next) void renamePlaylist(id, next)
        }
      },
      {
        label: 'Export as M3U8…',
        onSelect: async () => {
          const saved = await exportPlaylist(id)
          if (saved) setToast(`Exported to ${saved}`)
        }
      },
      { separator: true, label: '' },
      { label: 'Delete playlist', danger: true, onSelect: () => void removePlaylist(id) }
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
        setDragging(true)
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false)
      }}
      onDrop={(e) => void onDrop(e)}
    >
      <TitleBar />

      <div className={styles.body}>
        <Sidebar
          onOpenPlaylist={openPlaylistById}
          onPlaylistContextMenu={(e, id, name) => {
            e.preventDefault()
            setMenu({ x: e.clientX, y: e.clientY, items: playlistMenuItems(id, name) })
          }}
          openPlaylistId={openPlaylistId}
        />

        <main className={styles.content}>
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
                setMenu({
                  x: e.clientX,
                  y: e.clientY,
                  items: trackMenuItems(track, index, visibleTracks)
                })
              }}
            />
          )}
        </main>

        {panel === 'queue' && <QueuePanel onClose={() => setPanel(null)} />}
      </div>

      <PlayerBar
        onOpenQueue={() => setPanel(panel === 'queue' ? null : 'queue')}
        onOpenEq={() => setPanel(panel === 'eq' ? null : 'eq')}
        onOpenNowPlaying={() => setPanel(panel === 'now' ? null : 'now')}
      />

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />
      )}
      {properties && (
        <TrackProperties track={properties} onClose={() => setProperties(null)} />
      )}
      {toast && <Toast message={toast} onDone={() => setToast(null)} />}

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
