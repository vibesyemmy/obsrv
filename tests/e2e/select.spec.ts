import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { launchApp, openOverflow, rendererWindow } from './launch'
import {
  choose,
  menuActive,
  menuBox,
  menuKey,
  menuRows,
  menuScrolls,
  menuTicked,
  pickMenu,
  waitForMenu,
} from './helpers/select'

const FIXTURE = pathToFileURL(resolve(__dirname, '../fixtures/hairline.html')).href

test.describe.configure({ mode: 'serial' })

let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  app = await launchApp()
  page = await rendererWindow(app)
  // The native view is off screen on a page-less tab (see empty-state.spec.ts),
  // and the point of this file is that menus no longer disturb that view. Load
  // a page so it is on screen to begin with.
  await page.evaluate(u => window.obsrv.navigate(u), FIXTURE)
})
test.afterAll(async () => {
  await app.close()
})

/** Whether the native pane is on screen; main is the only honest witness. */
const nativeVisible = (): Promise<boolean> =>
  app.evaluate(() => (globalThis as any).__obsrv.native.isVisible() as boolean)

const closed = async (): Promise<void> => {
  await expect.poll(() => menuRows(app).then(r => r.length)).toBe(0)
}

const openPresets = async (): Promise<void> => {
  await page.locator('.preset-select').click()
  await waitForMenu(app)
}

const setWindow = (w: number, h: number): Promise<void> =>
  app.evaluate(({}, size: { w: number; h: number }) => {
    ;(globalThis as any).__obsrv.win.setContentSize(size.w, size.h)
  }, { w, h })

test('an open menu leaves the native pane alone', async () => {
  expect(await nativeVisible()).toBe(true)
  await openPresets()

  // The regression this architecture exists for. The menu is drawn in a view
  // stacked above the pane, so the pane no longer has to be taken off screen to
  // make room for it — an earlier version hid it, and the reference render
  // appeared to vanish every time the dropdown was opened.
  expect(await nativeVisible()).toBe(true)

  await menuKey(app, 'Escape')
  await closed()
  expect(await nativeVisible()).toBe(true)
})

test('the menu stays inside the window, however long it is', async () => {
  const fits = async (): Promise<void> => {
    const box = (await menuBox(app))!
    const win = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }))
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.y).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(win.w)
    expect(box.y + box.height).toBeLessThanOrEqual(win.h)
  }

  await openPresets()
  await fits()
  await menuKey(app, 'Escape')
  await closed()

  // The case that used to spill. At the default size the fifteen-row menu fits
  // under the toolbar and the clamp never engages; the platform popup, being
  // its own OS window, drew straight past the app's edge here. The window
  // enforces a 600px minimum, and that is short enough.
  await setWindow(1200, 200)
  await expect.poll(() => page.evaluate(() => window.innerHeight)).toBeLessThan(600)
  await openPresets()
  await fits()
  // It fits by scrolling, not by having been short enough all along.
  expect(await menuScrolls(app)).toBe(true)
  await menuKey(app, 'Escape')
  await closed()

  await setWindow(1600, 968)
  await expect.poll(() => page.evaluate(() => window.innerHeight)).toBeGreaterThan(900)
})

test('the keyboard drives it, and the trigger takes its focus back', async () => {
  await page.locator('.preset-select').focus()
  await page.keyboard.press('ArrowDown')
  await waitForMenu(app)

  // Type-ahead, which a fifteen-row list is where it earns its keep. Focus is
  // in the overlay while the menu is up, so the keys go there, not to the page.
  await menuKey(app, 'i')
  await expect.poll(() => menuActive(app)).toMatch(/iPhone/)

  await menuKey(app, 'Enter')
  await expect(page.locator('.preset-select')).toHaveAttribute('data-value', /^iphone/)
  // Focus returns to the chrome, or the next Tab would start from the body.
  await expect(page.locator('.preset-select')).toBeFocused()
})

test('Escape closes without choosing', async () => {
  const before = await page.locator('.preset-select').getAttribute('data-value')
  await openPresets()
  await menuKey(app, 'ArrowDown')
  await menuKey(app, 'Escape')
  await closed()
  expect(await page.locator('.preset-select').getAttribute('data-value')).toBe(before)
})

test('a press outside the menu dismisses it, and does not reach the page', async () => {
  await openPresets()
  // The overlay spans the window, so the area around the menu is what catches
  // this — the job a native menu's invisible tracking window does. Without it
  // the press would land on the page under test.
  await app.evaluate(() =>
    (globalThis as any).__obsrv.overlay.webContents.executeJavaScript(
      `document.querySelector('.menu-backdrop').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`,
    ),
  )
  await closed()
})

test('the groups and the tick survive the trip through main', async () => {
  await choose(app, page, '.preset-select', '1080p-27')
  await openPresets()

  // The rows are built in the chrome and drawn in another process; this is the
  // assertion that the payload arrives whole.
  const rows = await menuRows(app)
  expect(rows).toContain('laptop-768')
  expect(rows).toContain('1080p-27')
  expect(rows).toContain('iphone-61')
  expect(rows.at(-1)).toBe('custom')
  expect(await menuTicked(app)).toBe('1080p-27')
  await menuKey(app, 'Escape')
  await closed()

  // And the control still does its job, not merely its animation.
  await expect(page.locator('.pane.target-pane')).toContainText('1920×1080')
})
