import { useEffect, useMemo, useState } from 'react'
import type { Theme } from '@shared/types'
import { TitleBar } from './components/TitleBar'
import { Sidebar } from './components/Sidebar'
import { TopBar } from './components/TopBar'
import { TrackTable } from './components/TrackTable'
import { AlbumGrid, SimpleGrid } from './components/CardGrid'
import { ScanBanner } from './components/ScanBanner'
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
import styles from './App.module.css'

const VIEW_TITLES: Record<string, string> = {
  songs: 'Songs',
  albums: 'Albums',
  artists: 'Artists',
  genres: 'Genres',
  recent: 'Recently Added'
}

export default function App(): React.JSX.Element {
  const [theme, setTheme] = useState<Theme>('dark')
  const [dragging, setDragging] = useState(false)

  const {
    tracks, view, focus, query, searchResults, sortKey, sortDir,
    load, setFocus, setScan, scanPaths
  } = useLibrary()

  useEffect(() => {
    void load()
    void window.resonance.settings.getAll().then((s) => setTheme(s.theme))
    return window.resonance.library.onScanProgress(setScan)
  }, [load, setScan])

  useEffect(() => {
    document.documentElement.dataset['theme'] = theme
  }, [theme])

  async function toggleTheme(): Promise<void> {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    await window.resonance.settings.set('theme', next)
  }

  const albums = useMemo(() => groupByAlbum(tracks), [tracks])
  const artists = useMemo(() => groupByArtist(tracks), [tracks])
  const genres = useMemo(() => groupByGenre(tracks), [tracks])

  // A search overrides the current view entirely; results are already ranked by
  // FTS relevance, so column sorting is not applied to them.
  const searching = searchResults !== null && query.trim().length > 0

  const visibleTracks = useMemo(() => {
    if (searching) return searchResults!
    if (focus) {
      // Keys come from grouping.ts rather than being recomputed here. They were
      // duplicated once and the copies disagreed on trimming and on the
      // "Unknown …" fallbacks, so every untagged album opened to an empty list.
      const inFocus = tracks.filter((t) => {
        if (focus.kind === 'album') return albumKeyFor(t) === focus.key
        if (focus.kind === 'artist') return artistKeyFor(t) === focus.key
        return genreKeyFor(t) === focus.key
      })
      return sortTracks(inFocus, focus.kind === 'album' ? 'trackNo' : sortKey, sortDir)
    }
    if (view === 'recent') return recentlyAdded(tracks)
    return sortTracks(tracks, sortKey, sortDir)
  }, [searching, searchResults, focus, tracks, view, sortKey, sortDir])

  // Drag-and-drop accepts both files and folders (plan gap G1). Paths are
  // resolved in the preload via webUtils, since File.path no longer exists.
  async function onDrop(e: React.DragEvent): Promise<void> {
    e.preventDefault()
    setDragging(false)
    const paths = window.resonance.files.getPaths(Array.from(e.dataTransfer.files))
    if (paths.length) await scanPaths(paths)
  }

  const showingGrid = !searching && !focus && view !== 'songs' && view !== 'recent'

  const title = searching
    ? `Search: “${query}”`
    : focus
      ? focus.label
      : (VIEW_TITLES[view] ?? 'Library')

  const subtitle = searching
    ? `${visibleTracks.length} ${visibleTracks.length === 1 ? 'result' : 'results'}`
    : focus
      ? `${visibleTracks.length} ${visibleTracks.length === 1 ? 'track' : 'tracks'}`
      : undefined

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
        <Sidebar />

        <main className={styles.content}>
          <TopBar
            title={title}
            subtitle={subtitle}
            onBack={focus ? () => setFocus(null) : undefined}
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
            <TrackTable tracks={visibleTracks} showArt={!focus || focus.kind !== 'album'} />
          )}
        </main>
      </div>

      {dragging && (
        <div className={styles.dropOverlay} data-testid="drop-overlay">
          <div className={styles.dropCard}>
            <p className={styles.dropTitle}>Drop to add</p>
            <p className={styles.dropBody}>Files or folders — both work.</p>
          </div>
        </div>
      )}
    </div>
  )
}
