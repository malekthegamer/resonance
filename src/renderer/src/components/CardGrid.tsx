import { formatDuration } from '../core/format'
import type { AlbumGroup, SimpleGroup } from '../core/grouping'
import { AlbumArt } from './AlbumArt'
import styles from './CardGrid.module.css'

interface AlbumGridProps {
  albums: AlbumGroup[]
  onOpen(album: AlbumGroup): void
}

export function AlbumGrid({ albums, onOpen }: AlbumGridProps): React.JSX.Element {
  return (
    <div className={styles.grid} data-testid="album-grid">
      {albums.map((album) => (
        <button key={album.key} className={styles.card} onClick={() => onOpen(album)}>
          <AlbumArt
            artRef={album.artRef}
            seed={album.album}
            size={0}
            radius={12}
            className={styles.art}
          />
          <span className={styles.name} title={album.album}>
            {album.album}
          </span>
          <span className={styles.meta} title={album.albumArtist}>
            {album.albumArtist}
          </span>
          <span className={styles.sub}>
            {album.trackCount} {album.trackCount === 1 ? 'track' : 'tracks'} ·{' '}
            {formatDuration(album.duration)}
          </span>
        </button>
      ))}
    </div>
  )
}

interface SimpleGridProps {
  groups: SimpleGroup[]
  kind: 'artist' | 'genre'
  onOpen(group: SimpleGroup): void
}

export function SimpleGrid({ groups, kind, onOpen }: SimpleGridProps): React.JSX.Element {
  return (
    <div className={styles.grid} data-testid={`${kind}-grid`}>
      {groups.map((group) => (
        <button key={group.key} className={styles.card} onClick={() => onOpen(group)}>
          <AlbumArt
            artRef={group.artRef}
            seed={group.name}
            size={0}
            radius={kind === 'artist' ? 999 : 12}
            className={styles.art}
          />
          <span className={styles.name} title={group.name}>
            {group.name}
          </span>
          <span className={styles.sub}>
            {group.trackCount} {group.trackCount === 1 ? 'track' : 'tracks'}
          </span>
        </button>
      ))}
    </div>
  )
}
