import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  // Electron tests drive a single real app instance; parallel workers would
  // fight over the same settings file and window state.
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  outputDir: './test-results',
  use: {
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure'
  }
})
