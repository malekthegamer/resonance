import { useEffect, useRef } from 'react'
import styles from './ConfirmDialog.module.css'

interface Props {
  title: string
  body: string
  confirmLabel: string
  onConfirm(): void
  onCancel(): void
}

/**
 * Confirmation for destructive, irreversible actions.
 *
 * Deleting a playlist cannot be undone, so a misclick in a context menu should
 * not be enough to lose it. Focus starts on Cancel deliberately — the safe
 * option should be what Enter hits.
 */
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  onConfirm,
  onCancel
}: Props): React.JSX.Element {
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    cancelRef.current?.focus()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div className={styles.backdrop} onClick={onCancel} data-testid="confirm-backdrop">
      <div
        className={styles.dialog}
        onClick={(e) => e.stopPropagation()}
        role="alertdialog"
        aria-label={title}
        data-testid="confirm-dialog"
      >
        <h2 className={styles.title}>{title}</h2>
        <p className={styles.body}>{body}</p>
        <div className={styles.actions}>
          <button
            ref={cancelRef}
            className={styles.cancel}
            onClick={onCancel}
            data-testid="confirm-cancel"
          >
            Cancel
          </button>
          <button className={styles.confirm} onClick={onConfirm} data-testid="confirm-ok">
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
