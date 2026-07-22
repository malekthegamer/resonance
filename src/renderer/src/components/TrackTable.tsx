import { useEffect, useMemo, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { Track } from '@shared/types'
import { formatDuration } from '../core/format'
import type { SortKey } from '../core/sort'
import { useLibrary } from '../state/library'
import { useSelection } from '../state/selection'
import { modifierFor } from '../core/selection'
import { AlbumArt } from './AlbumArt'
import styles from './TrackTable.module.css'

const ROW_HEIGHT = 46

const COLUMNS: Array<{ key: SortKey; label: string; className: string }> = [
  { key: 'title', label: 'Title', className: styles.colTitle! },
  { key: 'artist', label: 'Artist', className: styles.colArtist! },
  { key: 'album', label: 'Album', className: styles.colAlbum! },
  { key: 'duration', label: 'Time', className: styles.colTime! }
]

interface Props {
  tracks: Track[]
  /** Hidden when a grid already establishes the album context. */
  showArt?: boolean
  onPlay?(tracks: Track[], index: number): void
  currentTrackId?: number | null
  onContextMenu?(e: React.MouseEvent, track: Track, index: number): void
}

/**
 * Virtualized track list.
 *
 * Only the visible rows are mounted, so a 50,000-track library costs the same
 * to render as a 50-track one — rendering every row is the usual reason a
 * library view janks on scroll.
 */
export function TrackTable({
  tracks,
  showArt = true,
  onPlay,
  currentTrackId,
  onContextMenu
}: Props): React.JSX.Element {
  const parentRef = useRef<HTMLDivElement>(null)
  const selection = useSelection((s) => s.selection)
  const click = useSelection((s) => s.click)
  const selectAllVisible = useSelection((s) => s.selectAllVisible)
  const clearSelection = useSelection((s) => s.clear)
  const sortKey = useLibrary((s) => s.sortKey)
  const sortDir = useLibrary((s) => s.sortDir)
  const toggleSort = useLibrary((s) => s.toggleSort)

  // Ranges and Ctrl+A operate on what is on screen, in its current order.
  const visibleIds = useMemo(() => tracks.map((t) => t.id), [tracks])

  // Ctrl+A and Escape are table-level, so they live here rather than in the
  // global shortcut hook where they would fire while typing in a dialog.
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      const target = e.target as HTMLElement | null
      const typing =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      if (typing) return

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        selectAllVisible(visibleIds)
      } else if (e.key === 'Escape') {
        clearSelection()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [visibleIds, selectAllVisible, clearSelection])

  const virtualizer = useVirtualizer({
    count: tracks.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10
  })

  if (tracks.length === 0) {
    return (
      <div className={styles.empty} data-testid="empty-state">
        <p className={styles.emptyTitle}>Nothing here yet</p>
        <p className={styles.emptyBody}>
          Add a folder from the sidebar, or drop music files anywhere on this window.
        </p>
      </div>
    )
  }

  return (
    <div className={styles.table} data-testid="track-table">
      <div className={styles.header} role="row">
        <span className={styles.colIndex}>#</span>
        {showArt && <span className={styles.colArt} />}
        {COLUMNS.map((col) => (
          <button
            key={col.key}
            className={`${styles.headCell} ${col.className} ${
              sortKey === col.key ? styles.sorted : ''
            }`}
            onClick={() => toggleSort(col.key)}
            data-testid={`sort-${col.key}`}
          >
            {col.label}
            {sortKey === col.key && (
              <span className={styles.caret} aria-hidden>
                {sortDir === 'asc' ? '▲' : '▼'}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className={styles.scroll} ref={parentRef} data-testid="track-scroll">
        <div className={styles.inner} style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((item) => {
            const track = tracks[item.index]!
            return (
              <div
                key={track.id}
                className={[
                  styles.row,
                  track.available ? '' : styles.unavailable,
                  currentTrackId === track.id ? styles.current : '',
                  selection.ids.has(track.id) ? styles.selected : ''
                ]
                  .filter(Boolean)
                  .join(' ')}
                style={{ transform: `translateY(${item.start}px)`, height: item.size }}
                data-testid="track-row"
                data-track-id={track.id}
                role="row"
                tabIndex={0}
                aria-selected={selection.ids.has(track.id)}
                onClick={(e) => click(track.id, modifierFor(e), visibleIds)}
                onDoubleClick={() => onPlay?.(tracks, item.index)}
                onContextMenu={(e) => onContextMenu?.(e, track, item.index)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onPlay?.(tracks, item.index)
                }}
              >
                <span className={styles.colIndex}>
                  {currentTrackId === track.id ? (
                    <span className={styles.eq} aria-label="Now playing">
                      <i />
                      <i />
                      <i />
                    </span>
                  ) : (
                    item.index + 1
                  )}
                </span>
                {showArt && (
                  <span className={styles.colArt}>
                    <AlbumArt artRef={track.artRef} seed={track.album || track.title} size={32} radius={6} />
                  </span>
                )}
                <span className={`${styles.cell} ${styles.colTitle}`} title={track.title}>
                  <span className={styles.title}>{track.title}</span>
                  {!track.available && <span className={styles.badge}>missing</span>}
                </span>
                <span className={`${styles.cell} ${styles.colArtist}`} title={track.artist}>
                  {track.artist || '—'}
                </span>
                <span className={`${styles.cell} ${styles.colAlbum}`} title={track.album}>
                  {track.album || '—'}
                </span>
                <span className={`${styles.cell} ${styles.colTime}`}>
                  {formatDuration(track.duration)}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
