import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

/**
 * Launches the built app with test hooks enabled, in a throwaway user-data
 * directory so specs that write settings cannot leak into later runs.
 */
export async function launchApp(): Promise<ElectronApplication> {
  const userData = mkdtempSync(join(tmpdir(), 'obsrv-e2e-'))
  const app = await electron.launch({
    args: [resolve(__dirname, '../../out/main/index.js'), `--user-data-dir=${userData}`],
    env: { ...process.env, OBSRV_TEST: '1' },
  })
  app.on('close', () => rmSync(userData, { recursive: true, force: true }))
  return app
}

/**
 * The renderer's own window. The NativePane (and, from Task 8, the offscreen
 * TargetSource) are Chromium page targets that Playwright discovers exactly
 * like the main BrowserWindow, so `app.firstWindow()` races between them.
 * Select by URL instead of trusting arrival order.
 *
 * The `window` event can fire while a page is still `about:blank`, so a bare
 * URL check on the event's `Page` can reject the real renderer before it has
 * navigated; `waitForURL` gives each candidate a chance to settle. The
 * listener is attached and the existing windows are enumerated in the same
 * synchronous tick (no `await` between them) so a window created in that
 * instant is never missed — this app creates exactly two windows, each
 * firing `window` once, so losing either event would hang forever. The
 * `/renderer/index.html` suffix only matches the built output — e2e always
 * runs the built app, so `ELECTRON_RENDERER_URL` dev mode is never in play.
 */
export async function rendererWindow(app: ElectronApplication): Promise<Page> {
  const pattern = /\/renderer\/index\.html$/
  return new Promise<Page>(resolve => {
    const tried = new Set<Page>()
    const tryPage = (w: Page): void => {
      if (tried.has(w)) return
      tried.add(w)
      w.waitForURL(pattern, { timeout: 5_000 }).then(
        () => {
          app.off('window', tryPage)
          resolve(w)
        },
        () => {
          // Not the renderer (e.g. the native pane's `about:blank` page) — ignore.
        },
      )
    }
    app.on('window', tryPage)
    for (const w of app.windows()) tryPage(w)
  })
}
