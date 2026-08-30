import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { launchApp, rendererWindow } from './launch'
import { choose } from './helpers/select'

const FIXTURE = pathToFileURL(resolve(__dirname, '../fixtures/hairline.html')).href

test.describe.configure({ mode: 'serial' })

let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  app = await launchApp()
  page = await rendererWindow(app)
  // The native view is off screen on a page-less tab (see empty-state.spec.ts),
  // and half of what this file asserts is about that view being taken away and
  // put back. Load a page so it is on screen to begin with.
  await page.evaluate(u => window.obsrv.navigate(u), FIXTURE)
})
test.afterAll(async () => {
  await app.close()
})

const menu = () => page.locator('.select-menu')
const openPresets = async (): Promise<void> => {
  await page.locator('.preset-select').click()
  await expect(menu()).toBeVisible()
}

const setWindow = (w: number, h: number): Promise<void> =>
  app.evaluate(({}, size: { w: number; h: number }) => {
    ;(globalThis as any).__obsrv.win.setContentSize(size.w, size.h)
  }, { w, h })

test('the menu stays inside the window, however long it is', async () => {
  await openPresets()

  const fits = async (): Promise<void> => {
    const box = (await menu().boundingBox())!
    const win = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }))
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.y).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(win.w)
    expect(box.y + box.height).toBeLessThanOrEqual(win.h)
  }
  await fits()
  await page.keyboard.press('Escape')

  // The case that actually used to spill. At the default size the fifteen-row
  // menu fits under the toolbar and clamping never engages, so proving the
  // guarantee means shrinking the window until the menu cannot fit — the
  // platform popup, being its own OS window, drew straight past the edge here
  // and over whatever was behind the app.
  // The window enforces a 600px minimum, so this is as short as it goes — and
  // it is short enough: the menu needs more room than the toolbar leaves.
  await setWindow(1200, 200)
  await expect.poll(() => page.evaluate(() => window.innerHeight)).toBeLessThan(600)
  await openPresets()
  await fits()
  // It fits by scrolling, not by having been short enough all along.
  expect(await menu().evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true)
  await page.keyboard.press('Escape')

  await setWindow(1600, 968)
  await expect.poll(() => page.evaluate(() => window.innerHeight)).toBeGreaterThan(900)
})

test('a menu over the native pane takes the view off screen, and puts it back', async () => {
  const visible = (): Promise<boolean> =>
    app.evaluate(() => (globalThis as any).__obsrv.native.isVisible() as boolean)
  expect(await visible()).toBe(true)

  await openPresets()
  // The view is an OS-composited layer above the renderer: left up, it would
  // cover the half of the menu that overlaps it. `capturePage` cannot see the
  // view, so main is the only honest witness — a screenshot would show the
  // menu intact either way and prove nothing.
  await expect.poll(visible).toBe(false)
  await expect(page.locator('.native-scrim')).toBeVisible()

  await page.keyboard.press('Escape')
  await expect.poll(visible).toBe(true)
  await expect(page.locator('.native-scrim')).toHaveCount(0)
})

test('a menu that clears the native pane leaves it alone', async () => {
  const visible = (): Promise<boolean> =>
    app.evaluate(() => (globalThis as any).__obsrv.native.isVisible() as boolean)

  // The profile control sits to the right of the seam with a four-row menu, so
  // it never reaches the native pane. Hiding the view for it would be a cost
  // paid for nothing, which is why the overlap is measured rather than assumed.
  await page.locator('.profile-select').click()
  await expect(menu()).toBeVisible()
  const m = (await menu().boundingBox())!
  const slot = (await page.locator('.native-slot').boundingBox())!
  expect(m.x).toBeGreaterThanOrEqual(slot.x + slot.width)

  expect(await visible()).toBe(true)
  await expect(page.locator('.native-scrim')).toHaveCount(0)
  await page.keyboard.press('Escape')
})

test('the keyboard drives it the way the native control did', async () => {
  await page.locator('.preset-select').focus()
  await page.keyboard.press('ArrowDown')
  await expect(menu()).toBeVisible()

  // Type-ahead, which is the thing a fifteen-row list would most miss.
  await page.keyboard.press('i')
  await expect(menu().locator('.select-option.active')).toHaveText(/iPhone/)

  await page.keyboard.press('Enter')
  await expect(menu()).toHaveCount(0)
  await expect(page.locator('.preset-select')).toHaveAttribute('data-value', /^iphone/)
  // Focus returns to the trigger, or the next Tab would start from the body.
  await expect(page.locator('.preset-select')).toBeFocused()
})

test('Escape closes without choosing', async () => {
  const before = await page.locator('.preset-select').getAttribute('data-value')
  await openPresets()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Escape')
  await expect(menu()).toHaveCount(0)
  expect(await page.locator('.preset-select').getAttribute('data-value')).toBe(before)
})

test('the chosen row is ticked, and choosing still applies the preset', async () => {
  await choose(page, '.preset-select', '1080p-27')
  await openPresets()
  const ticked = menu().locator('[aria-selected="true"]')
  await expect(ticked).toHaveCount(1)
  await expect(ticked).toHaveAttribute('data-value', '1080p-27')
  await page.keyboard.press('Escape')

  // The control still does its job, not merely its animation.
  await expect(page.locator('.pane.target-pane')).toContainText('1920×1080')
})
