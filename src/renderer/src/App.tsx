import { useEffect, useState } from 'react'
import type { AppInfo, Theme } from '@shared/types'
import { TitleBar } from './components/TitleBar'
import { formatDuration } from './core/format'
import styles from './App.module.css'

/**
 * Slice 0 shell: proves the frameless chrome, the glass/aurora treatment, the
 * theme toggle, and a real typed round-trip through the preload bridge. The
 * library UI replaces the card body in slice 3.
 */
export default function App(): React.JSX.Element {
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [theme, setTheme] = useState<Theme>('dark')
  const [pong, setPong] = useState<string>('—')

  useEffect(() => {
    void window.resonance.getAppInfo().then(setInfo)
    void window.resonance.settings.getAll().then((s) => setTheme(s.theme))
  }, [])

  useEffect(() => {
    document.documentElement.dataset['theme'] = theme
  }, [theme])

  async function toggleTheme(): Promise<void> {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    await window.resonance.settings.set('theme', next)
  }

  async function doPing(): Promise<void> {
    const started = performance.now()
    const reply = await window.resonance.ping()
    setPong(`${reply} in ${(performance.now() - started).toFixed(1)}ms`)
  }

  return (
    <div className={styles.shell}>
      <TitleBar />

      <main className={styles.body}>
        <section className={styles.card}>
          <p className={styles.kicker}>Slice 0 · scaffold &amp; spine</p>
          <h1 className={styles.h1}>Resonance</h1>
          <p className={styles.sub}>
            Frameless glass chrome, the fixed blue→purple identity, and a typed preload
            bridge. Everything below was read from the main process over IPC.
          </p>

          <dl className={styles.rows}>
            <div className={styles.row}>
              <dt>Electron</dt>
              <dd data-testid="v-electron">{info?.electron ?? '…'}</dd>
            </div>
            <div className={styles.row}>
              <dt>Chromium</dt>
              <dd>{info?.chrome ?? '…'}</dd>
            </div>
            <div className={styles.row}>
              <dt>Node</dt>
              <dd>{info?.node ?? '…'}</dd>
            </div>
            <div className={styles.row}>
              <dt>SQLite (node:sqlite)</dt>
              <dd
                data-testid="v-sqlite"
                className={info && info.sqlite ? styles.ok : styles.bad}
              >
                {info ? (info.sqlite ?? 'unavailable') : '…'}
              </dd>
            </div>
            <div className={styles.row}>
              <dt>Duration formatter</dt>
              <dd data-testid="v-format">{formatDuration(3671)}</dd>
            </div>
          </dl>

          <div className={styles.actions}>
            <button className={styles.primary} onClick={doPing} data-testid="ping">
              Ping main
            </button>
            <button className={styles.ghost} onClick={toggleTheme} data-testid="theme">
              {theme === 'dark' ? 'Light theme' : 'Dark theme'}
            </button>
            <span className={styles.pong} data-testid="pong">
              {pong}
            </span>
          </div>
        </section>
      </main>
    </div>
  )
}
