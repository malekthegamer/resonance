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
/**
 * Tests get their own userData directory.
 *
 * Without this they scan test fixtures into the real library, so the app the
 * user opens is polluted with `tone-440-6db` and a 112 MB `large-tone` — and
 * leftover state from a previous run makes the next run non-deterministic.
 */
export const TEST_USER_DATA = resolve(process.cwd(), 'test-results', 'userdata')

/**
 * `userDataDir` isolates a spec that would otherwise pollute the shared library.
 * The tag suite needs it: it rewrites tags on its own copies of the fixtures,
 * and those tracks landing in the common database would break the scan suite,
 * which asserts on the generated tag values.
 */
export async function launchApp(
  userDataDir: string = TEST_USER_DATA
): Promise<{ app: ElectronApplication; page: Page }> {
  const env = { ...process.env }
  delete env['ELECTRON_RUN_AS_NODE']

  const app = await electron.launch({
    args: [resolve(process.cwd(), 'out/main/index.js'), `--user-data-dir=${userDataDir}`],
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
