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
