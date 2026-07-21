import { resolve } from 'node:path'
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'

/**
 * Launches the built Electron app for e2e tests.
 *
 * `ELECTRON_RUN_AS_NODE` is set in this development environment (plan §A7). If
 * it leaks into the launch, Electron runs the entry file as plain Node, `app` is
 * undefined, and the failure looks like a crash in our own code rather than an
 * environment problem. It is stripped explicitly here.
 */
export async function launchApp(): Promise<{ app: ElectronApplication; page: Page }> {
  const env = { ...process.env }
  delete env['ELECTRON_RUN_AS_NODE']

  const app = await electron.launch({
    args: [resolve(process.cwd(), 'out/main/index.js')],
    env: env as Record<string, string>
  })

  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  return { app, page }
}

/** Reads a CSS custom property off :root, for verifying design tokens are live. */
export function rootVar(page: Page, name: string): Promise<string> {
  return page.evaluate(
    (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(),
    name
  )
}
