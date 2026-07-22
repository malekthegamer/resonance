import { useEffect, useState } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { useLibrary, type ViewId } from '../state/library'
import { usePlaylists } from '../state/playlists'
import { type PlaylistDrop } from '../core/dnd'
import type { PlaylistSummary } from '../../../main/db/playlists'
import {
  IconAlbums,
  IconArtists,
  IconGenres,
  IconPlus,
  IconRecent,
  IconSongs,
  IconPlaylist,
  IconImport
} from './Icons'
import styles from './Sidebar.module.css'

const VIEWS: Array<{ id: ViewId; label: string; Icon: (p: { size?: number }) => React.JSX.Element }> = [
  { id: 'songs', label: 'Songs', Icon: IconSongs },
  { id: 'albums', label: 'Albums', Icon: IconAlbums },
  { id: 'artists', label: 'Artists', Icon: IconArtists },
  { id: 'genres', label: 'Genres', Icon: IconGenres },
  { id: 'recent', label: 'Recently Added', Icon: IconRecent }
]

interface PlaylistRowProps {
  playlist: PlaylistSummary
  active: boolean
  onOpen(): void
  onContextMenu(e: React.MouseEvent): void
  onStartRename(): void
}

/**
 * A playlist row, doubling as a drop target for tracks dragged from the table.
 *
 * Split out because `useDroppable` is a hook and playlists are a map. The
 * droppable is registered on the `<li>` rather than the button so the target
 * keeps its rect while the row is being renamed inline and the button does not
 * exist.
 */
function PlaylistRow({
  playlist,
  active,
  onOpen,
  onContextMenu,
  onStartRename
}: PlaylistRowProps): React.JSX.Element {
  // Always registered, so its rect is measured when a drag begins. App's
  // collision detection is what keeps a queue reorder from landing here.
  const { setNodeRef, isOver } = useDroppable({
    id: `playlist-${playlist.id}`,
    data: { type: 'playlist', playlistId: playlist.id } satisfies PlaylistDrop
  })

  return (
    <li ref={setNodeRef}>
      <button
        className={`${styles.item} ${active ? styles.active : ''} ${isOver ? styles.dropTarget : ''}`}
        onClick={onOpen}
        onContextMenu={onContextMenu}
        onDoubleClick={onStartRename}
        data-testid="playlist-item"
        data-drop-over={isOver ? 'true' : undefined}
        title={playlist.name}
      >
        <span className={styles.icon} aria-hidden>
          <IconPlaylist size={16} />
        </span>
        <span className={styles.plName}>{playlist.name}</span>
        <span className={styles.plCount}>{playlist.trackCount}</span>
      </button>
    </li>
  )
}

interface SidebarProps {
  onNavigate(view: ViewId): void
  onOpenPlaylist(id: number): void
  onPlaylistContextMenu(e: React.MouseEvent, id: number, name: string): void
  openPlaylistId: number | null
  /** Playlist currently being renamed inline, driven from the context menu. */
  renamingId: number | null
  onRenamingChange(id: number | null): void
}

export function Sidebar({
  onNavigate,
  onOpenPlaylist,
  onPlaylistContextMenu,
  openPlaylistId,
  renamingId,
  onRenamingChange
}: SidebarProps): React.JSX.Element {
  const view = useLibrary((s) => s.view)
  const scanFolders = useLibrary((s) => s.scanFolders)
  const trackCount = useLibrary((s) => s.tracks.length)

  const playlists = usePlaylists((s) => s.playlists)
  const refreshPlaylists = usePlaylists((s) => s.refresh)
  const createPlaylist = usePlaylists((s) => s.create)
  const importFiles = usePlaylists((s) => s.importFiles)
  const renamePlaylist = usePlaylists((s) => s.rename)
  const [creating, setCreating] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [renameDraft, setRenameDraft] = useState('')

  // Seed the rename field when a rename starts, so the existing name is there
  // to edit rather than an empty box.
  useEffect(() => {
    if (renamingId == null) return
    setRenameDraft(playlists.find((p) => p.id === renamingId)?.name ?? '')
  }, [renamingId, playlists])

  async function commitRename(): Promise<void> {
    const id = renamingId
    const name = renameDraft.trim()
    onRenamingChange(null)
    if (id == null || !name) return
    await renamePlaylist(id, name)
  }

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
              className={`${styles.item} ${view === v.id && openPlaylistId == null ? styles.active : ''}`}
              onClick={() => onNavigate(v.id)}
              data-testid={`nav-${v.id}`}
              aria-current={view === v.id && openPlaylistId == null ? 'page' : undefined}
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
            <IconImport size={14} />
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
        {playlists.map((pl) =>
          renamingId === pl.id ? (
            <li key={pl.id}>
              <input
                className={styles.newInput}
                autoFocus
                value={renameDraft}
                onChange={(e) => setRenameDraft(e.target.value)}
                onBlur={() => void commitRename()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void commitRename()
                  if (e.key === 'Escape') onRenamingChange(null)
                }}
                data-testid="playlist-rename-input"
                aria-label="Rename playlist"
              />
            </li>
          ) : (
            <PlaylistRow
              key={pl.id}
              playlist={pl}
              active={openPlaylistId === pl.id}
              onOpen={() => onOpenPlaylist(pl.id)}
              onContextMenu={(e) => onPlaylistContextMenu(e, pl.id, pl.name)}
              onStartRename={() => onRenamingChange(pl.id)}
            />
          )
        )}
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
