import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

/**
 * Launches the built app with test hooks enabled, in a throwaway user-data
 * directory so specs that write settings cannot leak into later runs.
 */
export async function launchApp(): Promise<ElectronApplication> {
  const userData = mkdtempSync(join(tmpdir(), 'obsrv-e2e-'))
  return electron.launch({
    args: [resolve(__dirname, '../../out/main/index.js'), `--user-data-dir=${userData}`],
    env: { ...process.env, OBSRV_TEST: '1' },
  })
}

/**
 * The renderer's own window. The NativePane (and, from Task 8, the offscreen
 * TargetSource) are Chromium page targets that Playwright discovers exactly
 * like the main BrowserWindow, so `app.firstWindow()` races between them.
 * Select by URL instead of trusting arrival order.
 */
export async function rendererWindow(app: ElectronApplication): Promise<Page> {
  const isRenderer = (w: Page): boolean => w.url().endsWith('/renderer/index.html')
  return app.windows().find(isRenderer) ?? app.waitForEvent('window', isRenderer)
}
