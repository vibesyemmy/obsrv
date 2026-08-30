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

test('the chrome is three rows and the screen row holds the screen controls', async () => {
  // Tabs, browsing, screen — the strip furthest from the panes.
  await expect(page.locator('.chrome-row')).toHaveCount(3)
  for (const sel of [
    '.preset-select',
    '.view-control',
    '.panes-control',
    '.profile-select',
  ]) {
    await expect(page.locator(`.chrome-screen ${sel}`)).toHaveCount(1)
  }
})

test('the settings modal opens, closes on Escape, and lists its sections', async () => {
  await expect(page.locator('.settings-modal')).toHaveCount(0)
  await page.click('.toggle-settings')
  await expect(page.locator('.settings-modal')).toHaveCount(1)
  for (const sel of ['.nav-display', '.nav-screens', '.nav-session', '.nav-agent', '.nav-updates']) {
    await expect(page.locator(`.settings-nav ${sel}`)).toHaveCount(1)
  }
  // Display first: it is the highest-stakes setting and was the hardest to find.
  await expect(page.locator('.settings-nav button').first()).toHaveClass(/nav-display/)
  await page.keyboard.press('Escape')
  await expect(page.locator('.settings-modal')).toHaveCount(0)
})

// Escape hands the focus back rather than dropping it on the body, so the
// keyboard user is left where they started instead of at the top of the page.
test('Escape returns the focus to the button that opened it', async () => {
  await page.click('.toggle-settings')
  await expect(page.locator('.settings-modal')).toHaveCount(1)
  await page.keyboard.press('Escape')
  await expect(page.locator('.settings-modal')).toHaveCount(0)
  await expect(page.locator('.toggle-settings')).toBeFocused()
})

test('a press on the backdrop closes it', async () => {
  await page.click('.toggle-settings')
  await expect(page.locator('.settings-modal')).toHaveCount(1)
  // Deliberately outside the dialog: the backdrop spans the window, which is
  // also what stops a press reaching the chrome behind it.
  await page.locator('.modal-backdrop').click({ position: { x: 12, y: 12 } })
  await expect(page.locator('.settings-modal')).toHaveCount(0)
})

// The menu this replaced had to dodge the native pane, which is an OS-level
// view that covers renderer paint. A modal does not: the pane is taken off
// screen while it is up (asserted in controls.spec.ts), so the only thing left
// to hold is that the dialog stays inside the window at the smallest size the
// window allows.
test('the modal stays inside the window', async () => {
  await app.evaluate(() => (globalThis as any).__obsrv.win.setContentSize(900, 600))
  await expect.poll(() => page.evaluate(() => window.innerWidth)).toBeLessThan(1000)
  await page.click('.toggle-settings')

  const box = (await page.locator('.settings-modal').boundingBox())!
  const win = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }))
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.y).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(win.w)
  expect(box.y + box.height).toBeLessThanOrEqual(win.h)

  await page.keyboard.press('Escape')
  await app.evaluate(() => (globalThis as any).__obsrv.win.setContentSize(1600, 968))
  await expect.poll(() => page.evaluate(() => window.innerWidth)).toBeGreaterThan(1500)
})

// Focus must not wander into chrome the user cannot see: the panes are covered
// and the native view is off screen, so a Tab that escaped the dialog would
// land on controls that are not there any more.
test('Tab stays inside the dialog', async () => {
  await page.click('.toggle-settings')
  const inside = (): Promise<boolean> =>
    page.evaluate(() => !!document.querySelector('.settings-modal')?.contains(document.activeElement))
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab')
    expect(await inside()).toBe(true)
  }
  await page.keyboard.press('Escape')
})

test('the chrome renders exactly as tall as main reserves', async () => {
  const toolbarH: number = await app.evaluate(() => (globalThis as any).__obsrv.toolbarH)
  expect(toolbarH).toBeGreaterThan(0)
  const chrome = await page.locator('.chrome').boundingBox()
  expect(chrome!.height).toBe(toolbarH)
})

test('icon buttons are at least 30px', async () => {
  const back = await page.locator('.chrome-browse .icon-button').first().boundingBox()
  expect(back!.width).toBeGreaterThanOrEqual(30)
  expect(back!.height).toBeGreaterThanOrEqual(30)
})

// Both CSS defects this branch fixed were invisible to the suite until someone
// looked at a screenshot. Every nav row starts its label at the same x, so a
// section that grew a chip cannot indent differently from the rest.
test('every settings nav row starts its label at the same x', async () => {
  await page.click('.toggle-settings')
  await page.waitForSelector('.settings-modal')

  const edges = await page.evaluate(() =>
    [...document.querySelectorAll('.settings-nav button')].map(row =>
      Math.round((row.firstElementChild as HTMLElement).getBoundingClientRect().left),
    ),
  )

  expect(edges).toHaveLength(5)
  expect(new Set(edges).size).toBe(1)
  await page.keyboard.press('Escape')
})
