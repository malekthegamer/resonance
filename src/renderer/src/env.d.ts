/// <reference types="vite/client" />

import type { ResonanceApi } from '../../preload/index'

/**
 * Ambient types for the renderer.
 *
 * CSS modules are compiled by Vite, which knows how to turn them into an object
 * of class names. TypeScript does not, so without this every `import styles
 * from './X.module.css'` is an unresolved module.
 */
declare module '*.module.css' {
  const classes: Readonly<Record<string, string>>
  export default classes
}

declare module '*.css' {
  const content: string
  export default content
}

/**
 * The preload bridge. Declared here as well as in the preload's own .d.ts so
 * the renderer sees it regardless of which files a given tsconfig pulls in.
 */
declare global {
  interface Window {
    resonance: ResonanceApi
  }
}

export {}
