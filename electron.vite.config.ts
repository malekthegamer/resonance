import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

// Paths resolve from the project root; electron-vite always runs from there.
const r = (p: string): string => resolve(process.cwd(), p)

// These ship as pure ESM. The main process is bundled to CJS (so the sandboxed
// preload stays CJS too), so they must be bundled in rather than externalized —
// a `require()` of an ESM-only package throws ERR_REQUIRE_ESM at runtime.
const BUNDLE_ESM_DEPS = ['electron-store', 'music-metadata', 'chokidar']

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: BUNDLE_ESM_DEPS })],
    resolve: { alias: { '@shared': r('shared') } },
    build: {
      rollupOptions: { input: { index: r('src/main/index.ts') } }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': r('shared') } },
    build: {
      rollupOptions: { input: { index: r('src/preload/index.ts') } }
    }
  },
  renderer: {
    root: r('src/renderer'),
    resolve: {
      alias: { '@renderer': r('src/renderer/src'), '@shared': r('shared') }
    },
    plugins: [react()],
    build: {
      rollupOptions: { input: { index: r('src/renderer/index.html') } }
    }
  }
})
