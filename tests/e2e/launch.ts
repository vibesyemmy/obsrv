import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

/**
 * Launches the built app with test hooks enabled, in a throwaway user-data
 * directory so specs that write settings cannot leak into later runs.
 *
 * `userData` overrides that directory, for the one thing a throwaway dir
 * cannot express: what the app remembers *across* launches. A caller that
 * passes one owns it — it is neither created nor removed here, because the
 * point is that a second launch reads what the first one left.
 *
 * Resolves only once `boot()` has published `globalThis.__obsrv`. Playwright's
 * `launch()` returns as soon as it has *started* the app's `ready` sequence
 * (it fires `__playwright_run()` without awaiting it), and `boot()` runs in a
 * `whenReady().then(...)` continuation, so a spec whose first step is
 * `app.evaluate` would otherwise race the hook and see `__obsrv` undefined.
 * `boot()` registered its continuation at module load, before any evaluate
 * can register one, so awaiting `whenReady()` from here orders after it.
 */
export async function launchApp(
  extraArgs: string[] = [],
  extraEnv: Record<string, string> = {},
  userData?: string,
): Promise<ElectronApplication> {
  const dir = userData ?? mkdtempSync(join(tmpdir(), 'obsrv-e2e-'))
  const raw = await electron.launch({
    args: [resolve(__dirname, '../../out/main/index.js'), `--user-data-dir=${dir}`, ...extraArgs],
    env: { ...process.env, OBSRV_TEST: '1', ...extraEnv },
  })
  if (userData === undefined) raw.on('close', () => rmSync(dir, { recursive: true, force: true }))
  const app = hardenEvaluate(raw)
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
 * Closes the window behind `Resulting promise was garbage collected`.
 *
 * `app.evaluate` runs the function in main through the Node inspector's
 * `Runtime.callFunctionOn` with `awaitPromise`, and V8's inspector holds
 * the promise it awaits *weakly*. Playwright's utility wraps the result in
 * a promise; when the evaluated function is synchronous that promise is
 * already resolved as the inspector call returns, and nothing references
 * it until the next microtask checkpoint runs the inspector's handler. On
 * a main process that allocates hard — every tab's frames arrive over IPC —
 * a collection in that gap takes the promise, and Playwright reports it
 * collected although the function ran. Measured: a synchronous callback
 * with a collection forced in that gap is lost every time; a callback that
 * returns a promise resolves inside a checkpoint and is never lost.
 *
 * So every evaluate goes through an async frame in main: the caller's
 * function travels as source, is rebuilt there, and is awaited. Nothing is
 * retried, so nothing runs twice — the failure was a lost result, and a
 * retry would have re-run whatever the function did. The constraints are
 * Playwright's own: no closures, one serialisable argument. A string
 * expression is evaluated as before.
 */
function hardenEvaluate(raw: ElectronApplication): ElectronApplication {
  // A Proxy rather than an own property: Playwright names the API in its
  // error text after the frame that called it, so the real method must be
  // reached by an ordinary `evaluate(...)` call from a function of that
  // name — `bind` or `.call` would label every error `original` or `call`.
  return new Proxy(raw, {
    get(target, key, receiver) {
      if (key === 'evaluate') {
        return function evaluate(pageFunction: unknown, arg?: unknown): Promise<unknown> {
          return target.evaluate(
            async (electron, [src, a]: [string, unknown]) => {
              // eslint-disable-next-line no-new-func
              const built: unknown = new Function(`return (${src})`)()
              return typeof built === 'function' ? await built(electron, a) : built
            },
            [String(pageFunction), arg] as [string, unknown],
          )
        }
      }
      const value = Reflect.get(target, key, receiver)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
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
/**
 * Opens the settings modal, optionally on a named section.
 *
 * This replaced `openOverflow`: the overflow menu is gone, and the two things
 * it led to are now a modal and a drawer with a button each.
 */
export async function openSettings(
  page: Page,
  section?: 'display' | 'screens' | 'session' | 'agent' | 'updates',
): Promise<void> {
  if (!(await page.locator('.settings-modal').count())) {
    await page.click('.toggle-settings')
    await page.waitForSelector('.settings-modal')
  }
  if (section) {
    await page.click(`.settings-nav .nav-${section}`)
    await page.waitForSelector(`.settings-nav .nav-${section}.on`)
  }
}

/** Closes it again, for specs that go on to touch the panes. */
export async function closeSettings(page: Page): Promise<void> {
  if (!(await page.locator('.settings-modal').count())) return
  await page.click('.settings-done')
  await page.waitForSelector('.settings-modal', { state: 'detached' })
}
