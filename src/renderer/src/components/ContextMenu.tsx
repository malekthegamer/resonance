import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import styles from './ContextMenu.module.css'

export interface MenuItem {
  label: string
  onSelect?(): void
  /** Renders a divider when true; other fields are ignored. */
  separator?: boolean
  danger?: boolean
  submenu?: MenuItem[]
  disabled?: boolean
}

interface Props {
  x: number
  y: number
  items: MenuItem[]
  onClose(): void
}

export function ContextMenu({ x, y, items, onClose }: Props): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x, y })
  const [openSub, setOpenSub] = useState<number | null>(null)

  // Flip the menu back inside the window when it would overflow — a menu opened
  // near the bottom-right edge would otherwise be partly unreachable.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const nextX = x + rect.width > window.innerWidth - 8 ? Math.max(8, x - rect.width) : x
    const nextY = y + rect.height > window.innerHeight - 8 ? Math.max(8, y - rect.height) : y
    setPos({ x: nextX, y: nextY })
  }, [x, y, items])

  useEffect(() => {
    function onDown(e: MouseEvent): void {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose()
    }
    // `capture` so the menu closes even when the click lands on something that
    // stops propagation.
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', onClose)
    return () => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onClose)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      className={styles.menu}
      style={{ left: pos.x, top: pos.y }}
      role="menu"
      data-testid="context-menu"
    >
      {items.map((item, i) =>
        item.separator ? (
          <div key={i} className={styles.separator} role="separator" />
        ) : (
          <div
            key={i}
            className={styles.itemWrap}
            onMouseEnter={() => setOpenSub(item.submenu ? i : null)}
          >
            <button
              className={`${styles.item} ${item.danger ? styles.danger : ''}`}
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                if (item.submenu) return
                item.onSelect?.()
                onClose()
              }}
            >
              {item.label}
              {item.submenu && <span className={styles.chevron}>›</span>}
            </button>

            {item.submenu && openSub === i && (
              <div className={styles.submenu} role="menu">
                {item.submenu.length === 0 ? (
                  <span className={styles.emptySub}>No playlists yet</span>
                ) : (
                  item.submenu.map((sub, j) => (
                    <button
                      key={j}
                      className={styles.item}
                      role="menuitem"
                      onClick={() => {
                        sub.onSelect?.()
                        onClose()
                      }}
                    >
                      {sub.label}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        )
      )}
    </div>
  )
}
