import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { launchApp, rendererWindow } from './launch'

/**
 * Nobody is looking at a hidden window. The active target rasterises at a
 * fixed frame rate with `backgroundThrottling` off — by design, so the pane
 * never stutters when the app is merely unfocused — which also means that,
 * left alone, it would paint a full viewport at 30 fps for nobody the whole
 * time the window is hidden, minimised or entirely behind another app. On a
 * machine whose GPU is already struggling (see docs/gpu-reset.md), that is
 * exactly the load wanted least while the user is elsewhere.
 *
 * The fixture animates, so "still rasterising" is measurable as paints.
 */

const ANIMATED = pathToFileURL(resolve(__dirname, '../fixtures/animated.html')).href
const TALL = pathToFileURL(resolve(__dirname, '../fixtures/tall.html')).href

let app: ElectronApplication
let page: Page

const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms))

/** Paints the active target produced over `ms`. */
const paintsOver = (ms: number): Promise<number> =>
  app.evaluate(async (_e, ms: number) => {
    const wc = (globalThis as any).__obsrv.target.webContents
    let n = 0
    const on = (): void => {
      n++
    }
    wc.on('paint', on)
    await new Promise(r => setTimeout(r, ms))
    wc.off('paint', on)
    return n
  }, ms)

const painting = (): Promise<boolean> => app.evaluate(() => (globalThis as any).__obsrv.session.painting)

const setShown = (shown: boolean): Promise<void> =>
  app.evaluate((_e, shown: boolean) => {
    const win = (globalThis as any).__obsrv.win
    if (shown) win.show()
    else win.hide()
  }, shown)

test.beforeAll(async () => {
  app = await launchApp()
  page = await rendererWindow(app)
  await page.fill('.url-form input', ANIMATED)
  await page.press('.url-form input', 'Enter')
  await expect.poll(() => paintsOver(500)).toBeGreaterThan(2)
})
test.afterAll(async () => {
  await app.close()
})

test('hiding the window stops the target rasterising, and showing it resumes', async () => {
  await setShown(false)
  await expect.poll(painting).toBe(false)
  // Paints already in flight land; then nothing.
  await sleep(300)
  expect(await paintsOver(700)).toBe(0)

  await setShown(true)
  await expect.poll(painting).toBe(true)
  expect(await paintsOver(700)).toBeGreaterThan(2)
})

test('minimising counts as hidden', async () => {
  await app.evaluate(() => (globalThis as any).__obsrv.win.minimize())
  await expect.poll(painting).toBe(false)
  await app.evaluate(() => (globalThis as any).__obsrv.win.restore())
  await expect.poll(painting).toBe(true)
})

test('a navigation while hidden raises no stall notice, and the page is there on return', async () => {
  await setShown(false)
  await expect.poll(painting).toBe(false)
  await page.fill('.url-form input', TALL)
  await page.press('.url-form input', 'Enter')
  await sleep(3500)
  await expect(page.locator('.stall')).toBeHidden()

  // Resuming invalidates the target: the frame the hidden navigation owed
  // arrives now, so the watchdog has nothing to say either.
  await setShown(true)
  await expect.poll(painting).toBe(true)
  await sleep(3000)
  await expect(page.locator('.stall')).toBeHidden()
})

test('a tab activated while hidden stays paused until the window returns', async () => {
  await setShown(false)
  await expect.poll(painting).toBe(false)
  const id: string = await app.evaluate(() => {
    const tabs = (globalThis as any).__obsrv.tabs
    const session = tabs.add()
    tabs.activate(session.id)
    return session.id
  })
  expect(await painting()).toBe(false)
  await setShown(true)
  await expect.poll(painting).toBe(true)
  await app.evaluate((_e, id: string) => (globalThis as any).__obsrv.tabs.close(id), id)
})

// An agent capturing a hidden window must see the page as it is now, not the
// last frame painted before the window went away. `captureVisible` and
// `captureTarget` take this hold for their duration.
test('a painting hold rasterises a hidden window until released', async () => {
  await setShown(false)
  await expect.poll(painting).toBe(false)
  const seen = await app.evaluate(() => {
    const ctx = (globalThis as any).__obsrv
    const release = ctx.tabs.holdPainting()
    const during = ctx.session.painting
    release()
    release() // idempotent
    return { during, after: ctx.session.painting }
  })
  expect(seen).toEqual({ during: true, after: false })
  await setShown(true)
  await expect.poll(painting).toBe(true)
})
