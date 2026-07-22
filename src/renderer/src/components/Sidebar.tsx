import { useEffect, useState } from 'react'
import { useLibrary, type ViewId } from '../state/library'
import { usePlaylists } from '../state/playlists'
import {
  IconAlbums,
  IconArtists,
  IconGenres,
  IconPlus,
  IconRecent,
  IconSongs,
  IconPlaylist
} from './Icons'
import styles from './Sidebar.module.css'

const VIEWS: Array<{ id: ViewId; label: string; Icon: (p: { size?: number }) => React.JSX.Element }> = [
  { id: 'songs', label: 'Songs', Icon: IconSongs },
  { id: 'albums', label: 'Albums', Icon: IconAlbums },
  { id: 'artists', label: 'Artists', Icon: IconArtists },
  { id: 'genres', label: 'Genres', Icon: IconGenres },
  { id: 'recent', label: 'Recently Added', Icon: IconRecent }
]

interface SidebarProps {
  onOpenPlaylist(id: number): void
  onPlaylistContextMenu(e: React.MouseEvent, id: number, name: string): void
  openPlaylistId: number | null
}

export function Sidebar({
  onOpenPlaylist,
  onPlaylistContextMenu,
  openPlaylistId
}: SidebarProps): React.JSX.Element {
  const view = useLibrary((s) => s.view)
  const setView = useLibrary((s) => s.setView)
  const scanFolders = useLibrary((s) => s.scanFolders)
  const trackCount = useLibrary((s) => s.tracks.length)

  const playlists = usePlaylists((s) => s.playlists)
  const refreshPlaylists = usePlaylists((s) => s.refresh)
  const createPlaylist = usePlaylists((s) => s.create)
  const importFiles = usePlaylists((s) => s.importFiles)
  const [creating, setCreating] = useState(false)
  const [draftName, setDraftName] = useState('')

  useEffect(() => {
    void refreshPlaylists()
  }, [refreshPlaylists])

  async function commitCreate(): Promise<void> {
    const name = draftName.trim()
    setCreating(false)
    setDraftName('')
    if (!name) return
    const id = await createPlaylist(name)
    onOpenPlaylist(id)
  }

  return (
    <nav className={styles.sidebar} aria-label="Library">
      <p className={styles.heading}>Library</p>
      <ul className={styles.list}>
        {VIEWS.map((v) => (
          <li key={v.id}>
            <button
              className={`${styles.item} ${view === v.id ? styles.active : ''}`}
              onClick={() => setView(v.id)}
              data-testid={`nav-${v.id}`}
              aria-current={view === v.id ? 'page' : undefined}
            >
              <span className={styles.icon} aria-hidden>
                <v.Icon size={16} />
              </span>
              {v.label}
            </button>
          </li>
        ))}
      </ul>

      <div className={styles.plHead}>
        <p className={styles.heading}>Playlists</p>
        <div className={styles.plActions}>
          <button
            className={styles.plAction}
            onClick={() => void importFiles()}
            title="Import M3U playlist"
            aria-label="Import playlist"
            data-testid="import-playlist"
          >
            ↧
          </button>
          <button
            className={styles.plAction}
            onClick={() => setCreating(true)}
            title="New playlist"
            aria-label="New playlist"
            data-testid="new-playlist"
          >
            <IconPlus size={14} />
          </button>
        </div>
      </div>

      <ul className={styles.list} data-testid="playlist-list">
        {creating && (
          <li>
            <input
              className={styles.newInput}
              autoFocus
              value={draftName}
              placeholder="Playlist name"
              onChange={(e) => setDraftName(e.target.value)}
              onBlur={() => void commitCreate()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void commitCreate()
                if (e.key === 'Escape') {
                  setCreating(false)
                  setDraftName('')
                }
              }}
              data-testid="playlist-name-input"
            />
          </li>
        )}
        {playlists.map((pl) => (
          <li key={pl.id}>
            <button
              className={`${styles.item} ${openPlaylistId === pl.id ? styles.active : ''}`}
              onClick={() => onOpenPlaylist(pl.id)}
              onContextMenu={(e) => onPlaylistContextMenu(e, pl.id, pl.name)}
              data-testid="playlist-item"
              title={pl.name}
            >
              <span className={styles.icon} aria-hidden>
                <IconPlaylist size={16} />
              </span>
              <span className={styles.plName}>{pl.name}</span>
              <span className={styles.plCount}>{pl.trackCount}</span>
            </button>
          </li>
        ))}
      </ul>

      <div className={styles.spacer} />

      <button className={styles.addBtn} onClick={() => void scanFolders()} data-testid="add-folder">
        <IconPlus size={15} />
        Add folder
      </button>
      <p className={styles.count} data-testid="track-count">
        {trackCount.toLocaleString()} {trackCount === 1 ? 'track' : 'tracks'}
      </p>
    </nav>
  )
}
