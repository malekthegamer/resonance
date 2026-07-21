import Store from 'electron-store'
import { DEFAULT_SETTINGS, type Settings } from '@shared/types'

/**
 * Small persisted app settings (theme, window geometry, and later volume/EQ/
 * session). Deliberately separate from the library database: this is a handful
 * of values that must survive a corrupt or deleted library, and electron-store
 * gives us atomic writes for free.
 */
const store = new Store<Settings>({
  name: 'resonance-settings',
  defaults: DEFAULT_SETTINGS
}) as Store<Settings> & {
  get<K extends keyof Settings>(key: K): Settings[K]
  set<K extends keyof Settings>(key: K, value: Settings[K]): void
}

export function getSetting<K extends keyof Settings>(key: K): Settings[K] {
  return store.get(key)
}

export function setSetting<K extends keyof Settings>(key: K, value: Settings[K]): void {
  store.set(key, value)
}

export function getAllSettings(): Settings {
  return { ...DEFAULT_SETTINGS, ...(store.store as Partial<Settings>) }
}
