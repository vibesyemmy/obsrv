import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

/**
 * Launches the built app with test hooks enabled, in a throwaway user-data
 * directory so specs that write settings cannot leak into later runs.
 *
 * Resolves only once `boot()` has published `globalThis.__obsrv`. Playwright's
 * `launch()` returns as soon as it has *started* the app's `ready` sequence
 * (it fires `__playwright_run()` without awaiting it), and `boot()` runs in a
 * `whenReady().then(...)` continuation, so a spec whose first step is
 * `app.evaluate` would otherwise race the hook and see `__obsrv` undefined.
 * `boot()` registered its continuation at module load, before any evaluate
 * can register one, so awaiting `whenReady()` from here orders after it.
 */
export async function launchApp(extraArgs: string[] = [], extraEnv: Record<string, string> = {}): Promise<ElectronApplication> {
  const userData = mkdtempSync(join(tmpdir(), 'obsrv-e2e-'))
  const app = await electron.launch({
    args: [resolve(__dirname, '../../out/main/index.js'), `--user-data-dir=${userData}`, ...extraArgs],
    env: { ...process.env, OBSRV_TEST: '1', ...extraEnv },
  })
  app.on('close', () => rmSync(userData, { recursive: true, force: true }))
  await app.evaluate(async ({ app: electronApp }) => {
    await electronApp.whenReady()
    if (!(globalThis as { __obsrv?: unknown }).__obsrv) {
      throw new Error('OBSRV_TEST hook missing: boot() did not publish globalThis.__obsrv')
    }
  })
  // From Task 14 the React shell does IPC of its own on mount: `setViewport`,
  // `setNativeBounds`, `setMode`, the frame handshake. A spec that drives
  // main before those land races them (its own `setViewport` is overwritten
  // by the shell's, say). The NATIVE readout shows the slot's size only after
  // the mount effects have run, so wait for it before handing the app over.
  const page = await rendererWindow(app)
  await page.waitForFunction(
    () => /NATIVE\s*[1-9]\d*×[1-9]/.test(document.body.textContent ?? ''),
    undefined,
    { timeout: 10_000 },
  )
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

/**
 * Opens the toolbar's overflow menu if it is not already open. Pixel-exact,
 * the two drawers and the agent toggle live there now, so a spec that clicks
 * one has to reach it first.
 */
export async function openOverflow(page: Page): Promise<void> {
  if (await page.locator('.overflow-menu').count()) return
  await page.click('.overflow-button')
  await page.waitForSelector('.overflow-menu')
}
