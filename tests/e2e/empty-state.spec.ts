import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { launchApp, rendererWindow } from './launch'

test.describe.configure({ mode: 'serial' })

let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  app = await launchApp()
  page = await rendererWindow(app)
})
test.afterAll(async () => {
  await app.close()
})

const TALL = pathToFileURL(resolve(__dirname, '../fixtures/tall.html')).href

/**
 * Whether the OS-composited native view is on screen. The renderer cannot see
 * it and `capturePage` cannot photograph it, so the only honest source is main:
 * an empty state with the view still up would be a white rectangle sitting on
 * top of half of it, and a screenshot would not show the fault.
 */
const nativeShowing = (): Promise<boolean> =>
  app.evaluate(() => (globalThis as any).__obsrv.session.native.isVisible())

test('a tab with no page shows the empty state, and hides the native view', async () => {
  await page.locator('.tab-new').click()

  await expect(page.locator('.empty-state')).toBeVisible()
  // The slot stays mounted — it is what reports native bounds — but the view
  // it stands for comes off screen, which is what lets the empty state span
  // both panes instead of crowding into the target half.
  await expect(page.locator('.native-slot')).toHaveCount(1)
  await expect.poll(nativeShowing).toBe(false)

  // The overlay really does cover the native side, not just its own pane.
  const row = await page.locator('.panes').boundingBox()
  const art = await page.locator('.empty-state').boundingBox()
  expect(art?.width).toBeCloseTo(row?.width ?? 0, 0)
})

test('the empty state navigates through the same path as the toolbar', async () => {
  await page.locator('.empty-input').fill(TALL)
  await page.locator('.empty-go').click()

  // Gone because the tab has a page now — not because the form cleared itself.
  await expect(page.locator('.empty-state')).toHaveCount(0)
  await expect(page.locator('.native-slot')).toBeVisible()
  await expect.poll(nativeShowing).toBe(true)
  // The toolbar shows what main applied, which is how we know the navigation
  // went through `navigate` rather than some second implementation.
  await expect(page.locator('.url-form input[role="combobox"]')).toHaveValue(TALL)
})
