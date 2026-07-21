import type { ResonanceApi } from './index'

declare global {
  interface Window {
    resonance: ResonanceApi
  }
}

export {}
