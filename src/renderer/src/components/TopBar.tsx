import { useEffect, useRef } from 'react'
import type { Theme } from '@shared/types'
import { useLibrary } from '../state/library'
import { IconMoon, IconSearch, IconSun } from './Icons'
import styles from './TopBar.module.css'

interface Props {
  title: string
  subtitle?: string
  onBack?: () => void
  theme: Theme
  onToggleTheme: () => void
}

export function TopBar({ title, subtitle, onBack, theme, onToggleTheme }: Props): React.JSX.Element {
  const query = useLibrary((s) => s.query)
  const setQuery = useLibrary((s) => s.setQuery)
  const inputRef = useRef<HTMLInputElement>(null)

  // Ctrl+F focuses search, per the spec's in-app shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        inputRef.current?.focus()
        inputRef.current?.select()
      }
      if (e.key === 'Escape' && document.activeElement === inputRef.current) {
        void setQuery('')
        inputRef.current?.blur()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setQuery])

  return (
    <header className={styles.bar}>
      {onBack && (
        <button className={styles.back} onClick={onBack} data-testid="back" aria-label="Back">
          ‹
        </button>
      )}
      <div className={styles.titles}>
        <h1 className={styles.title} data-testid="view-title">
          {title}
        </h1>
        {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
      </div>

      <div className={styles.spacer} />

      <div className={styles.searchWrap}>
        <span className={styles.searchIcon} aria-hidden>
          <IconSearch size={15} />
        </span>
        <input
          ref={inputRef}
          className={styles.search}
          type="search"
          placeholder="Search library…"
          value={query}
          onChange={(e) => void setQuery(e.target.value)}
          data-testid="search"
          aria-label="Search library"
        />
      </div>

      <button
        className={styles.themeBtn}
        onClick={onToggleTheme}
        data-testid="theme"
        aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        title={theme === 'dark' ? 'Light theme' : 'Dark theme'}
      >
        {theme === 'dark' ? <IconSun size={16} /> : <IconMoon size={16} />}
      </button>
    </header>
  )
}
