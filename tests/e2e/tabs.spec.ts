import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { launchApp, rendererWindow } from './launch'

// Each test leaves the session painting again, but they share one app and the
// frame collector is global to the renderer, so order still matters.
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

/**
 * Whether the offscreen source is actually rasterising, read from Chromium
 * rather than from our own flag — the point of the test is that the wish
 * reaches the webContents, so asserting on the wish would prove nothing.
 */
const painting = (): Promise<boolean> =>
  app.evaluate(() => (globalThis as any).__obsrv.session.target.webContents.isPainting())

test('a session stops and resumes painting', async () => {
  expect(await painting()).toBe(true)

  await app.evaluate(() => (globalThis as any).__obsrv.session.setPainting(false))
  await expect.poll(painting).toBe(false)

  await app.evaluate(() => (globalThis as any).__obsrv.session.setPainting(true))
  await expect.poll(painting).toBe(true)
})

test('a suspended session stays suspended across a device-scale-factor change', async () => {
  // A dsf change recreates the offscreen window, and a fresh webContents
  // starts painting. A background tab whose preset is changed by an agent (or
  // by the CLI) must not quietly resume producing frames nobody reads.
  await app.evaluate(() => (globalThis as any).__obsrv.session.setPainting(false))
  await expect.poll(painting).toBe(false)

  await app.evaluate(() => (globalThis as any).__obsrv.target.setViewport(390, 844, 2))
  await expect.poll(painting, { timeout: 10_000 }).toBe(false)

  await app.evaluate(() => {
    const ctx = (globalThis as any).__obsrv
    ctx.session.setPainting(true)
    ctx.target.setViewport(1280, 800, 1)
  })
  await expect.poll(painting, { timeout: 10_000 }).toBe(true)
})

test('re-pointing the bus rebinds the source rather than stacking listeners', async () => {
  const frameListeners = (): Promise<number> =>
    app.evaluate(() => (globalThis as any).__obsrv.target.listenerCount('frame'))

  expect(await frameListeners()).toBe(1)

  // Re-pointing at the source it already has exercises exactly the unbind and
  // rebind that activation does, without a second session to build. A `bind`
  // that subscribed without unsubscribing would show up here as 2, then 3, and
  // in the app as every paint delivered once per tab ever activated.
  await app.evaluate(() => {
    const ctx = (globalThis as any).__obsrv
    ctx.bus.setSource(ctx.target)
    ctx.bus.setSource(ctx.target)
  })

  expect(await frameListeners()).toBe(1)
})

test('re-pointing the bus fills the canvas without waiting for a repaint', async () => {
  // The target is showing a static page: it has no reason of its own to paint
  // again. Anything the collector sees came from `setSource`'s invalidate.
  await page.evaluate(() => {
    const w = window as any
    if (w.__off) w.__off()
    w.__frames = []
    w.__off = window.obsrv.onFrame(() => w.__frames.push(1))
  })
  await page.waitForTimeout(300)
  await page.evaluate(() => ((window as any).__frames.length = 0))

  await app.evaluate(() => {
    const ctx = (globalThis as any).__obsrv
    ctx.bus.setSource(ctx.target)
  })

  await page.waitForFunction(() => (window as any).__frames.length > 0, undefined, { timeout: 5_000 })
})
