import { useLibrary, type ViewId } from '../state/library'
import styles from './Sidebar.module.css'

const VIEWS: Array<{ id: ViewId; label: string; icon: string }> = [
  { id: 'songs', label: 'Songs', icon: '♪' },
  { id: 'albums', label: 'Albums', icon: '▦' },
  { id: 'artists', label: 'Artists', icon: '☺' },
  { id: 'genres', label: 'Genres', icon: '◈' },
  { id: 'recent', label: 'Recently Added', icon: '✦' }
]

export function Sidebar(): React.JSX.Element {
  const view = useLibrary((s) => s.view)
  const setView = useLibrary((s) => s.setView)
  const scanFolders = useLibrary((s) => s.scanFolders)
  const trackCount = useLibrary((s) => s.tracks.length)

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
                {v.icon}
              </span>
              {v.label}
            </button>
          </li>
        ))}
      </ul>

      <div className={styles.spacer} />

      <button className={styles.addBtn} onClick={() => void scanFolders()} data-testid="add-folder">
        + Add folder
      </button>
      <p className={styles.count} data-testid="track-count">
        {trackCount.toLocaleString()} {trackCount === 1 ? 'track' : 'tracks'}
      </p>
    </nav>
  )
}
