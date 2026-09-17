import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { launchApp, rendererWindow } from './launch'

/**
 * PROBE, not a gate — `chore-flaky-leaders-0917`, shape 1.
 *
 * `panes:230` and `panes:259` time out waiting for `.load-error-state` with
 * **element(s) not found**, while `panes:197` — the same invalid host, the same
 * app, 294 ms earlier — passes waiting on `.badge-error`. The error reaches the
 * toolbar and not the window.
 *
 * **PRE-REGISTERED, before running, both arms and what each would mean:**
 *
 * - **ARM A, the latch hypothesis.** A successful navigation clears the error
 *   (what `panes:216` does immediately before `:230`), then a failing one.
 *   If clearing leaves something latched, `.load-error-state` should be missing
 *   at some rate here.
 * - **ARM B, the control.** A failing navigation straight after another failing
 *   one, with no clearing in between. This must **never** miss. If it misses
 *   too, the latch is not the cause and the fault is in rendering the state at
 *   all.
 *
 * **If both arms are clean**, the latch is refuted and nothing here explains
 * the CI failures — which is a result, not a failed probe.
 */

let app: ElectronApplication
let page: Page
const FIXTURE = pathToFileURL(resolve(__dirname, '../fixtures/hairline.html')).href
const BAD = 'https://obsrv-no-such-host.invalid'
const RUNS = 15

const go = async (url: string): Promise<void> => {
  await page.fill('.url-form input', url)
  await page.press('.url-form input', 'Enter')
}

/** Whether the window-level error state appeared within the budget. */
const errorStateAppeared = async (ms: number): Promise<boolean> => {
  try {
    await expect(page.locator('.load-error-state')).toBeVisible({ timeout: ms })
    return true
  } catch {
    return false
  }
}

test.describe.configure({ timeout: 300_000 })

test.beforeAll(async () => {
  app = await launchApp()
  page = await rendererWindow(app)
})
test.afterAll(async () => {
  await app.close()
})

test('ARM A: a cleared error, then a failing load', async () => {
  let missed = 0
  for (let i = 0; i < RUNS; i++) {
    await go(FIXTURE)
    await expect(page.locator('.load-error-state')).toHaveCount(0, { timeout: 15_000 })
    await go(BAD)
    if (!(await errorStateAppeared(8_000))) missed++
  }
  console.log(`[latch] ARM A (good → bad): ${missed}/${RUNS} missed the window state`)
})

test('ARM B, the control: a failing load straight after a failing load', async () => {
  let missed = 0
  await go(BAD)
  await errorStateAppeared(15_000)
  for (let i = 0; i < RUNS; i++) {
    await go(BAD)
    if (!(await errorStateAppeared(8_000))) missed++
  }
  console.log(`[latch] ARM B (bad → bad, the control): ${missed}/${RUNS} missed — it must be 0`)
})

test('ARM A, timestamped: what order the renderer sees on a miss', async () => {
  // Subscribes ALONGSIDE App.tsx rather than replacing it: the preload's
  // `on*` helpers add a listener and hand back an unsubscribe, so the app's
  // own handlers still run and the timings are of the real path. The DOM
  // observer records the effect — when the window state actually appears and
  // disappears — because the store is not exposed to the page.
  await page.evaluate(() => {
    const w = window as unknown as { __log: { t: number; what: string; detail: string }[]; obsrv: Record<string, (cb: (a: never) => void) => void> }
    w.__log = []
    const at = (what: string, detail = ''): void => void w.__log.push({ t: Date.now(), what, detail })
    w.obsrv.onUrlChanged(((e: { url: string }) => at('url-changed', e.url)) as never)
    w.obsrv.onTargetNavigating((() => at('target-navigating')) as never)
    w.obsrv.onLoadError((({ error }: { error: { url?: string; code?: number } }) => at('load-error', `${error?.url ?? ''} ${error?.code ?? ''}`)) as never)
    new MutationObserver(() => {
      at(document.querySelector('.load-error-state') === null ? 'state GONE' : 'state SHOWN')
    }).observe(document.body, { childList: true, subtree: true })
  })

  // MAIN's side too: `did-fail-load` carries a code, and nativePane.ts filters
  // ERR_ABORTED (-3) — a navigation replaced rather than failed. If a miss
  // shows -3 where a hit shows -105, the error never reaches the renderer
  // because main never sends one, and the question moves off the renderer
  // entirely.
  await app.evaluate(() => {
    const g = globalThis as any
    g.__fails = [] as { t: number; pane: string; code: number; url: string }[]
    for (const [pane, wc] of [
      ['native', g.__obsrv.native.webContents],
      ['target', g.__obsrv.target.webContents],
    ] as [string, any][]) {
      wc.on('did-fail-load', (_e: unknown, code: number, _d: string, url: string, isMainFrame: boolean) => {
        if (isMainFrame) g.__fails.push({ t: Date.now(), pane, code, url })
      })
    }
  })

  const rounds: string[] = []
  let missed = 0
  let hitShown = false
  for (let i = 0; i < RUNS * 2; i++) {
    await page.evaluate(() => void ((window as unknown as { __log: unknown[] }).__log.length = 0))
    await app.evaluate(() => void ((globalThis as any).__fails.length = 0))
    await go(FIXTURE)
    await expect(page.locator('.load-error-state')).toHaveCount(0, { timeout: 15_000 })
    // What the field ACTUALLY holds at the moment Enter is pressed. The app
    // writes the committed address into it on `url-changed`, so a late one
    // from the previous navigation would overwrite what was typed — and the
    // submit would re-send the old address rather than the bad one.
    await page.fill('.url-form input', BAD)
    const atSubmit = await page.inputValue('.url-form input')
    await page.press('.url-form input', 'Enter')
    const shown = await errorStateAppeared(8_000)
    if (shown && !hitShown) {
      hitShown = true
      // THE INSTRUMENT'S OWN CONTROL: a hit must show a `load-error`. If it
      // does not, "no load-error on a miss" says nothing about the product.
      const log = await page.evaluate(() => (window as unknown as { __log: { t: number; what: string; detail: string }[] }).__log)
      const fails = await app.evaluate(() => (globalThis as any).__fails as { pane: string; code: number }[])
      const t0 = log[0]?.t ?? 0
      console.log(
        `[latch-order] a HIT, for comparison — main's did-fail-load: ${JSON.stringify(fails.map(f => `${f.pane} ${f.code}`))}\n` +
          log.map(l => `    +${String(l.t - t0).padStart(5)}ms  ${l.what.padEnd(18)} ${l.detail.split('/').pop() ?? ''}`).join('\n'),
      )
    }
    if (!shown) {
      missed++
      // NEVER or LATE? Keep waiting past the 8 s budget and record when the
      // failure lands, if it ever does. A load that fails at 12 s is a slow
      // lookup; one that never fails is a lost navigation, and they need
      // different fixes.
      const late = await page
        .locator('.load-error-state')
        .waitFor({ state: 'visible', timeout: 25_000 })
        .then(() => 'arrived late')
        .catch(() => 'never arrived, even at 33 s')
      const panes = await app.evaluate(() => {
        const g = globalThis as any
        return {
          native: g.__obsrv.native.webContents.getURL(),
          nativeLoading: g.__obsrv.native.webContents.isLoading(),
          target: g.__obsrv.target.webContents.getURL(),
          targetLoading: g.__obsrv.target.webContents.isLoading(),
        }
      })
      rounds.push(
        `    the field held at submit: ${atSubmit.split('/').pop()}\n` +
        `    past the budget: ${late}\n` +
          `    panes now: native=${panes.native.split('/').pop()} loading=${panes.nativeLoading}  ` +
          `target=${panes.target.split('/').pop()} loading=${panes.targetLoading}`,
      )
      const log = await page.evaluate(() => (window as unknown as { __log: { t: number; what: string; detail: string }[] }).__log)
      const fails = await app.evaluate(() => (globalThis as any).__fails as { t: number; pane: string; code: number; url: string }[])
      const t0 = log[0]?.t ?? 0
      rounds.push(
        `    main's did-fail-load this round: ${JSON.stringify(fails.map(f => `${f.pane} ${f.code}`))}`,
      )
      rounds.push(
        `  MISS on round ${i}:\n` +
          log.map(l => `    +${String(l.t - t0).padStart(5)}ms  ${l.what.padEnd(18)} ${l.detail.split('/').pop() ?? ''}`).join('\n'),
      )
    }
  }
  console.log(`[latch-order] ${missed}/${RUNS * 2} missed\n${rounds.join('\n') || '  (no miss captured this run)'}`)
})
