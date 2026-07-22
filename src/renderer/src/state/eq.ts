import { create } from 'zustand'
import { EQ_BAND_COUNT } from '../audio/engine'
import {
  BUILT_IN_PRESETS,
  clampGain,
  FLAT_GAINS,
  findPreset,
  normalizeGains,
  type EqPreset
} from '../audio/equalizer'
import { getEngine } from './player'

interface EqState {
  enabled: boolean
  gains: number[]
  customPresets: EqPreset[]
  activePreset: string | null

  hydrate(): Promise<void>
  setBand(index: number, db: number): void
  applyPreset(name: string): void
  reset(): void
  setEnabled(enabled: boolean): void
  saveCustom(name: string): Promise<void>
  deleteCustom(name: string): Promise<void>
  allPresets(): EqPreset[]
}

/** Pushes the effective curve to the audio graph. Bypassed means flat. */
function pushToEngine(gains: number[], enabled: boolean): void {
  getEngine()?.setBandGains(enabled ? gains : FLAT_GAINS)
}

async function persist(state: {
  enabled: boolean
  gains: number[]
  customPresets: EqPreset[]
}): Promise<void> {
  await window.resonance.settings.set('eq', {
    enabled: state.enabled,
    gains: state.gains,
    customPresets: state.customPresets
  })
}

let hydrated = false

export const useEq = create<EqState>((set, get) => ({
  enabled: true,
  gains: [...FLAT_GAINS],
  customPresets: [],
  activePreset: 'Flat',

  async hydrate() {
    // Idempotent: a second hydrate would clobber whatever the user has since
    // changed, because the read is async and lands later.
    if (hydrated) return
    hydrated = true
    const settings = await window.resonance.settings.getAll()
    const stored = settings.eq
    const gains = normalizeGains(stored?.gains)
    const customPresets = Array.isArray(stored?.customPresets) ? stored.customPresets : []
    const enabled = stored?.enabled ?? true

    set({
      gains,
      customPresets,
      enabled,
      activePreset: findPreset([...BUILT_IN_PRESETS, ...customPresets], gains)
    })
    pushToEngine(gains, enabled)
  },

  setBand(index, db) {
    if (index < 0 || index >= EQ_BAND_COUNT) return
    const gains = [...get().gains]
    gains[index] = clampGain(db)

    // Applied to the live graph immediately — the whole point of a graphic EQ is
    // that dragging a slider is audible while dragging, not after releasing.
    getEngine()?.setBandGain(index, get().enabled ? gains[index]! : 0)

    set({ gains, activePreset: findPreset(get().allPresets(), gains) })
    void persist({ enabled: get().enabled, gains, customPresets: get().customPresets })
  },

  applyPreset(name) {
    const found = get().allPresets().find((p) => p.name === name)
    if (!found) return
    const gains = [...found.gains]
    set({ gains, activePreset: name })
    pushToEngine(gains, get().enabled)
    void persist({ enabled: get().enabled, gains, customPresets: get().customPresets })
  },

  reset() {
    get().applyPreset('Flat')
  },

  setEnabled(enabled) {
    set({ enabled })
    pushToEngine(get().gains, enabled)
    void persist({ enabled, gains: get().gains, customPresets: get().customPresets })
  },

  async saveCustom(name) {
    const clean = name.trim()
    if (!clean) return
    // Replacing a preset of the same name is what a user expects from "save".
    const customPresets = [
      ...get().customPresets.filter((p) => p.name !== clean),
      { name: clean, gains: [...get().gains], builtIn: false }
    ]
    set({ customPresets, activePreset: clean })
    await persist({ enabled: get().enabled, gains: get().gains, customPresets })
  },

  async deleteCustom(name) {
    const customPresets = get().customPresets.filter((p) => p.name !== name)
    set({ customPresets })
    await persist({ enabled: get().enabled, gains: get().gains, customPresets })
  },

  allPresets() {
    return [...BUILT_IN_PRESETS, ...get().customPresets]
  }
}))
