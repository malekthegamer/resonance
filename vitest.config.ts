import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@renderer': resolve(process.cwd(), 'src/renderer/src'),
      '@shared': resolve(process.cwd(), 'shared')
    }
  },
  test: {
    // Unit tests cover pure logic only; anything needing a real Electron window
    // is a Playwright e2e test instead.
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node'
  }
})
