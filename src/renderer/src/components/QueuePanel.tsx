import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent
} from '@dnd-kit/core'
import { restrictToVerticalAxis } from '@dnd-kit/modifiers'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { formatDuration } from '../core/format'
import { usePlayer } from '../state/player'
import { AlbumArt } from './AlbumArt'
import { IconClose } from './Icons'
import styles from './QueuePanel.module.css'

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
    id
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
  const { queue, moveInQueue } = usePlayer()

  const sensors = useSensors(
    // A small distance threshold means a click still registers as a click; without
    // it every click on a row starts a drag and the row becomes unclickable.
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  // dnd-kit needs stable string ids. Queue positions are the identity here
  // because the same track may legitimately appear twice in a queue.
  const ids = queue.items.map((_, i) => `q-${i}`)

  function onDragEnd(event: DragEndEvent): void {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const from = ids.indexOf(String(active.id))
    const to = ids.indexOf(String(over.id))
    if (from >= 0 && to >= 0) moveInQueue(from, to)
  }

  const totalDuration = queue.items.reduce(
    (sum, id) => sum + (usePlayer.getState().known.get(id)?.duration ?? 0),
    0
  )

  return (
    <aside className={styles.panel} data-testid="queue-panel">
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
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToVerticalAxis]}
          onDragEnd={onDragEnd}
        >
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            <ul className={styles.list}>
              {ids.map((id, index) => (
                <QueueRow key={id} id={id} index={index} isCurrent={index === queue.index} />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}
    </aside>
  )
}
