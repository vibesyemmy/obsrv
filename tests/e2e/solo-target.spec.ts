import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { launchApp, rendererWindow } from './launch'

let app: ElectronApplication
let page: Page

/** Asks main whether the native WebContentsView is currently on screen. */
const nativeVisible = () =>
  app.evaluate(() => (globalThis as any).__obsrv.native.isVisible() as boolean)

test.beforeAll(async () => {
  app = await launchApp()
  page = await rendererWindow(app)
})
test.afterAll(async () => {
  await app.close()
})

test('setNativeVisible hides and restores the OS-level view', async () => {
  expect(await nativeVisible()).toBe(true)

  await page.evaluate(() => (window as any).obsrv.setNativeVisible(false))
  await expect.poll(nativeVisible).toBe(false)

  await page.evaluate(() => (window as any).obsrv.setNativeVisible(true))
  await expect.poll(nativeVisible).toBe(true)
})

test('image mode and panes do not clobber each other', async () => {
  // Hidden by panes, then image mode ends: still hidden, because panes says so.
  await page.evaluate(() => (window as any).obsrv.setNativeVisible(false))
  await page.evaluate(() => (window as any).obsrv.setMode('image'))
  await expect.poll(nativeVisible).toBe(false)

  await page.evaluate(() => (window as any).obsrv.setMode('url'))
  await expect.poll(nativeVisible).toBe(false)

  await page.evaluate(() => (window as any).obsrv.setNativeVisible(true))
  await expect.poll(nativeVisible).toBe(true)
})

test('the target pane takes the whole window and gives it back', async () => {
  const paneWidth = () =>
    page.evaluate(() => (document.querySelector('.target-pane') as HTMLElement).getBoundingClientRect().width)
  const shared = await paneWidth()

  await page.click('.panes-target')
  await expect(page.locator('.native-slot')).toHaveCount(0)
  await expect.poll(nativeVisible).toBe(false)
  await expect.poll(paneWidth).toBeGreaterThan(shared * 1.8)

  await page.click('.panes-both')
  await expect(page.locator('.native-slot')).toHaveCount(1)
  await expect.poll(nativeVisible).toBe(true)
  await expect.poll(paneWidth).toBeLessThan(shared * 1.2)
})

test('the native view is repositioned before it is shown again', async () => {
  await page.click('.panes-target')
  await expect.poll(nativeVisible).toBe(false)
  await page.click('.panes-both')
  await expect.poll(nativeVisible).toBe(true)

  const [slot, view] = await Promise.all([
    page.evaluate(() => {
      const r = (document.querySelector('.native-slot') as HTMLElement).getBoundingClientRect()
      return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width) }
    }),
    app.evaluate(() => (globalThis as any).__obsrv.native.getBounds()),
  ])
  expect(view.width).toBe(slot.width)
  expect(view.x).toBe(slot.x)
  expect(view.y).toBe(slot.y)
})
