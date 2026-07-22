import { useDroppable } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { formatDuration } from '../core/format'
import { usePlayer } from '../state/player'
import { type QueueDrag, type QueueDrop } from '../core/dnd'
import { AlbumArt } from './AlbumArt'
import { IconClose } from './Icons'
import styles from './QueuePanel.module.css'

/*
 * This panel used to own a `DndContext`. It does not any more — there is a
 * single provider at App level, because dnd-kit does not support nesting them
 * and library rows have to be able to drop *into* this panel. Reordering still
 * works the same way; the sensors, modifiers and drag-end handling moved up,
 * and the `SortableContext` below stayed.
 */

interface RowProps {
  id: string
  index: number
  isCurrent: boolean
}

function QueueRow({ id, index, isCurrent }: RowProps): React.JSX.Element {
  const { queue, known, jumpTo, removeFromQueue } = usePlayer()
  const trackId = queue.items[index]!
  const track = known.get(trackId)

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    // The position, not the track id: the same track may legitimately appear
    // twice in a queue, so only the slot identifies the row.
    data: { type: 'queue-item', index } satisfies QueueDrag
  })

  return (
    <li
      ref={setNodeRef}
      className={`${styles.row} ${isCurrent ? styles.current : ''} ${
        isDragging ? styles.dragging : ''
      }`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      data-testid="queue-row"
      onDoubleClick={() => void jumpTo(index)}
      {...attributes}
      {...listeners}
    >
      <span className={styles.index}>{index + 1}</span>
      <AlbumArt
        artRef={track?.artRef ?? null}
        seed={track?.album || track?.title || 'x'}
        size={30}
        radius={6}
      />
      <span className={styles.meta}>
        <span className={styles.title}>{track?.title ?? 'Unknown'}</span>
        <span className={styles.artist}>{track?.artist || track?.album || '—'}</span>
      </span>
      <span className={styles.time}>{formatDuration(track?.duration ?? 0)}</span>
      <button
        className={styles.remove}
        // The row is a drag handle, so a click here must not also start a drag.
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation()
          removeFromQueue(index)
        }}
        aria-label="Remove from queue"
        title="Remove from queue"
        data-testid="queue-remove"
      >
        <IconClose size={13} />
      </button>
    </li>
  )
}

interface Props {
  onClose(): void
}

export function QueuePanel({ onClose }: Props): React.JSX.Element {
  const { queue } = usePlayer()

  // dnd-kit needs stable string ids; the position supplies one.
  const ids = queue.items.map((_, i) => `q-${i}`)

  /*
   * The panel itself is a drop target, so tracks can be dropped into an empty
   * queue or below the last row. A container this large would beat the row the
   * user is aiming at during a reorder — App's collision detection excludes it
   * from queue drags rather than this component tracking what is in flight.
   */
  const { setNodeRef, isOver } = useDroppable({
    id: 'queue-panel',
    data: { type: 'queue' } satisfies QueueDrop
  })

  const totalDuration = queue.items.reduce(
    (sum, id) => sum + (usePlayer.getState().known.get(id)?.duration ?? 0),
    0
  )

  return (
    <aside
      ref={setNodeRef}
      className={`${styles.panel} ${isOver ? styles.dropTarget : ''}`}
      data-testid="queue-panel"
      data-drop-over={isOver ? 'true' : undefined}
    >
      <header className={styles.head}>
        <div>
          <h2 className={styles.heading}>Play queue</h2>
          <p className={styles.sub}>
            {queue.items.length} {queue.items.length === 1 ? 'track' : 'tracks'} ·{' '}
            {formatDuration(totalDuration)}
          </p>
        </div>
        <button className={styles.close} onClick={onClose} aria-label="Close queue">
          <IconClose size={15} />
        </button>
      </header>

      {queue.items.length === 0 ? (
        <p className={styles.empty}>
          Nothing queued. Double-click a track, or use “Play next” from a right-click menu.
        </p>
      ) : (
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <ul className={styles.list}>
            {ids.map((id, index) => (
              <QueueRow key={id} id={id} index={index} isCurrent={index === queue.index} />
            ))}
          </ul>
        </SortableContext>
      )}
    </aside>
  )
}
