import { useEffect, useState } from 'react'
import { EQ_MAX_GAIN_DB } from '../audio/engine'
import { bandLabel } from '../audio/equalizer'
import { useEq } from '../state/eq'
import { IconClose } from './Icons'
import styles from './EqualizerPanel.module.css'

interface Props {
  onClose(): void
}

export function EqualizerPanel({ onClose }: Props): React.JSX.Element {
  const {
    gains, enabled, activePreset, hydrate, setBand, applyPreset, reset,
    setEnabled, saveCustom, deleteCustom, allPresets, customPresets
  } = useEq()
  const [saving, setSaving] = useState(false)
  const [draft, setDraft] = useState('')

  useEffect(() => {
    void hydrate()
  }, [hydrate])

  async function commitSave(): Promise<void> {
    const name = draft.trim()
    setSaving(false)
    setDraft('')
    if (name) await saveCustom(name)
  }

  return (
    <aside className={styles.panel} data-testid="eq-panel">
      <header className={styles.head}>
        <div>
          <h2 className={styles.heading}>Equalizer</h2>
          <p className={styles.sub}>10 bands · ±{EQ_MAX_GAIN_DB} dB</p>
        </div>
        <button className={styles.close} onClick={onClose} aria-label="Close equalizer">
          <IconClose size={15} />
        </button>
      </header>

      <div className={styles.controls}>
        <label className={styles.toggle}>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            data-testid="eq-enabled"
          />
          <span>{enabled ? 'On' : 'Bypassed'}</span>
        </label>

        <select
          className={styles.presetSelect}
          value={activePreset ?? 'custom'}
          onChange={(e) => applyPreset(e.target.value)}
          data-testid="eq-preset"
          aria-label="Preset"
        >
          {activePreset === null && <option value="custom">Custom</option>}
          {allPresets().map((p) => (
            <option key={p.name} value={p.name}>
              {p.name}
              {p.builtIn ? '' : ' ★'}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.bands} data-testid="eq-bands">
        {gains.map((gain, i) => (
          <div key={i} className={styles.band}>
            <span className={styles.gainValue}>
              {gain > 0 ? '+' : ''}
              {gain.toFixed(1)}
            </span>
            {/*
              A vertical range input. Rotated rather than using
              writing-mode, which Chromium only recently supported and which
              renders inconsistently at small sizes.
            */}
            <div className={styles.sliderWrap}>
              <input
                className={styles.slider}
                type="range"
                min={-EQ_MAX_GAIN_DB}
                max={EQ_MAX_GAIN_DB}
                step={0.5}
                value={gain}
                onChange={(e) => setBand(i, Number(e.target.value))}
                onDoubleClick={() => setBand(i, 0)}
                aria-label={`${bandLabel(i)} Hz`}
                data-testid={`eq-band-${i}`}
                disabled={!enabled}
              />
            </div>
            <span className={styles.bandLabel}>{bandLabel(i)}</span>
          </div>
        ))}
      </div>

      <footer className={styles.foot}>
        <button className={styles.action} onClick={reset} data-testid="eq-reset">
          Reset
        </button>
        {saving ? (
          <input
            className={styles.saveInput}
            autoFocus
            placeholder="Preset name"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => void commitSave()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void commitSave()
              if (e.key === 'Escape') {
                setSaving(false)
                setDraft('')
              }
            }}
            data-testid="eq-save-name"
          />
        ) : (
          <button
            className={styles.action}
            onClick={() => setSaving(true)}
            data-testid="eq-save"
          >
            Save preset
          </button>
        )}
        {activePreset && customPresets.some((p) => p.name === activePreset) && (
          <button
            className={`${styles.action} ${styles.danger}`}
            onClick={() => void deleteCustom(activePreset)}
          >
            Delete
          </button>
        )}
      </footer>
    </aside>
  )
}
