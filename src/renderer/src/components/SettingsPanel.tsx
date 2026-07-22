import { useEffect, useState } from 'react'
import type { Settings } from '@shared/types'
import type { ShortcutStatus } from '../../../main/shortcuts'
import { IconClose } from './Icons'
import styles from './SettingsPanel.module.css'

interface Props {
  onClose(): void
  onSettingsChanged(settings: Partial<Settings>): void
}

export function SettingsPanel({ onClose, onSettingsChanged }: Props): React.JSX.Element {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [shortcuts, setShortcuts] = useState<ShortcutStatus[]>([])

  useEffect(() => {
    void window.resonance.settings.getAll().then(setSettings)
    void window.resonance.desktop.shortcutStatus().then(setShortcuts)
  }, [])

  async function update<K extends keyof Settings>(key: K, value: Settings[K]): Promise<void> {
    setSettings((prev) => (prev ? { ...prev, [key]: value } : prev))
    await window.resonance.settings.set(key, value)
    onSettingsChanged({ [key]: value } as Partial<Settings>)
  }

  if (!settings) return <aside className={styles.panel} data-testid="settings-panel" />

  const failed = shortcuts.filter((s) => !s.registered)

  return (
    <aside className={styles.panel} data-testid="settings-panel">
      <header className={styles.head}>
        <h2 className={styles.heading}>Settings</h2>
        <button className={styles.close} onClick={onClose} aria-label="Close settings">
          <IconClose size={15} />
        </button>
      </header>

      <div className={styles.scroll}>
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Playback</h3>

          <label className={styles.row}>
            <span className={styles.label}>
              Crossfade
              <span className={styles.hint}>0 turns crossfade off</span>
            </span>
            <span className={styles.control}>
              <input
                type="range"
                min={0}
                max={12}
                step={0.5}
                value={settings.crossfadeSec}
                onChange={(e) => void update('crossfadeSec', Number(e.target.value))}
                data-testid="crossfade-slider"
              />
              <span className={styles.value}>
                {settings.crossfadeSec === 0 ? 'Off' : `${settings.crossfadeSec}s`}
              </span>
            </span>
          </label>
        </section>

        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Library</h3>

          <label className={styles.row}>
            <span className={styles.label}>
              Watch folders for changes
              <span className={styles.hint}>Detect files added or removed while running</span>
            </span>
            <input
              type="checkbox"
              checked={settings.watchFolders}
              onChange={(e) => void update('watchFolders', e.target.checked)}
              data-testid="watch-folders"
            />
          </label>
        </section>

        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Window</h3>

          <label className={styles.row}>
            <span className={styles.label}>
              Minimize to tray on close
              <span className={styles.hint}>Keeps Resonance running in the notification area</span>
            </span>
            <input
              type="checkbox"
              checked={settings.minimizeToTray}
              onChange={(e) => void update('minimizeToTray', e.target.checked)}
              data-testid="minimize-to-tray"
            />
          </label>

          <label className={styles.row}>
            <span className={styles.label}>Show visualizer</span>
            <input
              type="checkbox"
              checked={settings.showVisualizer}
              onChange={(e) => void update('showVisualizer', e.target.checked)}
              data-testid="show-visualizer"
            />
          </label>
        </section>

        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Global shortcuts</h3>
          <p className={styles.sectionNote}>
            These work while Resonance is in the background.
            {failed.length > 0 && (
              <>
                {' '}
                <strong className={styles.warn}>
                  {failed.length} could not be registered — another application already owns them.
                </strong>
              </>
            )}
          </p>

          <ul className={styles.shortcuts} data-testid="shortcut-list">
            {shortcuts.map((s) => (
              <li key={s.accelerator} className={styles.shortcut}>
                <span>{s.action}</span>
                <kbd className={s.registered ? styles.kbd : `${styles.kbd} ${styles.kbdFailed}`}>
                  {s.accelerator.replace('CommandOrControl', 'Ctrl')}
                </kbd>
              </li>
            ))}
          </ul>
        </section>

        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>In-app keys</h3>
          <ul className={styles.shortcuts}>
            {[
              ['Play / pause', 'Space'],
              ['Seek ±5s', '← / →'],
              ['Volume', '↑ / ↓'],
              ['Mute', 'M'],
              ['Next / previous', 'N / P'],
              ['Search', 'Ctrl+F']
            ].map(([action, key]) => (
              <li key={key} className={styles.shortcut}>
                <span>{action}</span>
                <kbd className={styles.kbd}>{key}</kbd>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </aside>
  )
}
