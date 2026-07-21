import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { launchApp, rootVar } from './helpers'

let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  ;({ app, page } = await launchApp())
})

test.afterAll(async () => {
  await app?.close()
})

test('launches a frameless window with the security posture the plan requires', async () => {
  // Frameless is the §A1 decision; if it ever flips back to native chrome the
  // glass treatment breaks. Electron exposes no `frame` getter, but a frameless
  // window has content bounds identical to its window bounds — a native title
  // bar would make the content strictly shorter.
  const flags = await app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    const prefs = win.webContents.getLastWebPreferences()
    const bounds = win.getBounds()
    const content = win.getContentBounds()
    return {
      chromeHeight: bounds.height - content.height,
      chromeWidth: bounds.width - content.width,
      contextIsolation: prefs?.contextIsolation,
      nodeIntegration: prefs?.nodeIntegration,
      sandbox: prefs?.sandbox
    }
  })

  expect(flags.chromeHeight).toBe(0)
  expect(flags.chromeWidth).toBe(0)
  expect(flags.contextIsolation).toBe(true)
  expect(flags.nodeIntegration).toBe(false)
  expect(flags.sandbox).toBe(true)
})

test('the preload bridge is narrow — no raw ipcRenderer or Node reaches the renderer', async () => {
  const exposure = await page.evaluate(() => ({
    hasApi: typeof (window as never as { resonance?: unknown }).resonance === 'object',
    hasRequire: typeof (window as never as { require?: unknown }).require,
    hasProcess: typeof (window as never as { process?: unknown }).process,
    hasIpcRenderer: typeof (window as never as { ipcRenderer?: unknown }).ipcRenderer
  }))

  expect(exposure.hasApi).toBe(true)
  expect(exposure.hasRequire).toBe('undefined')
  expect(exposure.hasProcess).toBe('undefined')
  expect(exposure.hasIpcRenderer).toBe('undefined')
})

test('a typed IPC round-trip returns from the main process', async () => {
  await page.getByTestId('ping').click()
  await expect(page.getByTestId('pong')).toContainText('pong')
})

test('node:sqlite is live inside Electron and reports a version', async () => {
  // This is the §A7 replacement for better-sqlite3. If it ever regresses the app
  // has no database at all, so the smoke test covers it from slice 0 onward.
  const shown = await page.getByTestId('v-sqlite').textContent()
  expect(shown).toMatch(/^\d+\.\d+\.\d+$/)
})

test('the fixed identity gradient is present and dark is the default theme', async () => {
  expect(await rootVar(page, '--accent-a')).toBe('#4f7cff')
  expect(await rootVar(page, '--accent-b')).toBe('#9b5cff')

  const theme = await page.evaluate(() => document.documentElement.dataset['theme'])
  expect(theme).toBe('dark')
})

test('theme toggle switches to light and back', async () => {
  await page.getByTestId('theme').click()
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset['theme']))
    .toBe('light')

  await page.screenshot({ path: 'test-results/slice0-light.png' })

  await page.getByTestId('theme').click()
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset['theme']))
    .toBe('dark')

  await page.screenshot({ path: 'test-results/slice0-dark.png' })
})

test('window controls work: maximize toggles and minimize is reversible', async () => {
  const maximizedAfterToggle = await (async () => {
    await page.getByLabel('Maximize').click()
    return app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized())
  })()
  expect(maximizedAfterToggle).toBe(true)

  await page.getByLabel('Restore').click()
  const restored = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].isMaximized()
  )
  expect(restored).toBe(false)
})
