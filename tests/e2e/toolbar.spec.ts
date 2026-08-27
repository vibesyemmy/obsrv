import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { launchApp, rendererWindow } from './launch'

let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  app = await launchApp()
  page = await rendererWindow(app)
})
test.afterAll(async () => {
  await app.close()
})

test('the chrome is two rows and the screen row holds the screen controls', async () => {
  await expect(page.locator('.chrome-row')).toHaveCount(2)
  for (const sel of [
    '.preset-select',
    '.view-control',
    '.panes-control',
    '.profile-select',
    '.surround-control',
  ]) {
    await expect(page.locator(`.chrome-screen ${sel}`)).toHaveCount(1)
  }
})

test('the overflow menu opens, closes on Escape, and holds the rare controls', async () => {
  await expect(page.locator('.overflow-menu')).toHaveCount(0)
  await page.click('.overflow-button')
  await expect(page.locator('.overflow-menu')).toHaveCount(1)
  for (const sel of ['.pixel-exact', '.toggle-panel', '.toggle-settings', '.agent-toggle']) {
    await expect(page.locator(`.overflow-menu ${sel}`)).toHaveCount(1)
  }
  await page.keyboard.press('Escape')
  await expect(page.locator('.overflow-menu')).toHaveCount(0)
})

// Escape hands the focus back rather than dropping it on the body, so the
// keyboard user is left where they started instead of at the top of the page.
test('Escape returns the focus to the overflow button', async () => {
  await page.click('.overflow-button')
  await expect(page.locator('.overflow-menu')).toHaveCount(1)
  await page.keyboard.press('Escape')
  await expect(page.locator('.overflow-menu')).toHaveCount(0)
  await expect(page.locator('.overflow-button')).toBeFocused()
})

// `OverflowMenu` dismisses on a mousedown outside itself; nothing else covers it.
test('a click outside the menu closes it', async () => {
  await page.click('.overflow-button')
  await expect(page.locator('.overflow-menu')).toHaveCount(1)
  await page.click('.url-form input')
  await expect(page.locator('.overflow-menu')).toHaveCount(0)
})

// The native pane is an OS-level `WebContentsView`: a click on the live page
// delivers no event to the renderer document at all, so the `mousedown`
// dismissal never fires and the menu would hang over the target pane until
// Escape. Focus leaving the renderer is the signal that survives that gap.
test('a click on the native pane closes the menu', async () => {
  await page.click('.overflow-button')
  await expect(page.locator('.overflow-menu')).toHaveCount(1)
  // What a click on the view does at the focus level, without depending on
  // where the view happens to sit on screen.
  await app.evaluate(() => (globalThis as any).__obsrv.native.webContents.focus())
  await expect(page.locator('.overflow-menu')).toHaveCount(0)
  // Hand the renderer its focus back so later tests type where they expect to.
  await page.bringToFront()
  await page.click('.url-form input')
})

// The rendered chrome and main's cold-start layout are one number in two
// places. Main reserves `TOOLBAR_H` for the toolbar before NativeSlot's first
// report; if `.chrome` renders any other height, the native pane is
// mispositioned on every cold start and every existing assertion still passes,
// because they are all inequalities. Read main's real value — a spec that
// hard-codes 82 on both sides closes nothing.
test('the chrome renders exactly as tall as main reserves', async () => {
  const toolbarH: number = await app.evaluate(() => (globalThis as any).__obsrv.toolbarH)
  expect(toolbarH).toBeGreaterThan(0)
  const chrome = await page.locator('.chrome').boundingBox()
  expect(chrome!.height).toBe(toolbarH)
})

// The native pane is an OS-level overlay that covers renderer paint, so a
// menu reaching into the left half of the window would be invisible.
test('the open menu stays over the target pane', async () => {
  await page.click('.overflow-button')
  const [menu, pane] = await Promise.all([
    page.locator('.overflow-menu').boundingBox(),
    page.locator('.target-pane').boundingBox(),
  ])
  expect(menu!.x).toBeGreaterThanOrEqual(pane!.x)
  await page.keyboard.press('Escape')
})

test('icon buttons are at least 30px', async () => {
  const back = await page.locator('.chrome-browse .icon-button').first().boundingBox()
  expect(back!.width).toBeGreaterThanOrEqual(30)
  expect(back!.height).toBeGreaterThanOrEqual(30)
})
