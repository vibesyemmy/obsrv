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
