import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { launchApp, rendererWindow } from './launch'

const FIXTURE = pathToFileURL(resolve(__dirname, '../fixtures/hairline.html')).href

let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  app = await launchApp()
  page = await rendererWindow(app)
})
test.afterAll(async () => {
  await app.close()
})

test('navigate loads both panes', async () => {
  const returned = await page.evaluate(u => window.obsrv.navigate(u), FIXTURE)
  expect(returned).toBe(FIXTURE)

  const urls = await app.evaluate(() => {
    const ctx = (globalThis as any).__obsrv
    return { native: ctx.native.webContents.getURL(), target: ctx.target.webContents.getURL() }
  })
  expect(urls.native).toBe(FIXTURE)
  expect(urls.target).toBe(FIXTURE)
})

test('reports the URL the native pane navigated to', async () => {
  const seen = await page.evaluate(async (u: string) => {
    const got = new Promise<string>(res => {
      const off = window.obsrv.onUrlChanged(v => {
        off()
        res(v)
      })
    })
    await window.obsrv.navigate(u)
    return got
  }, 'about:blank')

  expect(seen).toBe('about:blank')
})

test('setViewport clamps to MAX_VIEWPORT', async () => {
  expect(await page.evaluate(() => window.obsrv.setViewport(5000, 700))).toEqual({
    width: 4096,
    height: 700,
  })
  expect(await page.evaluate(() => window.obsrv.setViewport(800, 600))).toEqual({
    width: 800,
    height: 600,
  })
  expect(await app.evaluate(() => (globalThis as any).__obsrv.target.getViewport())).toEqual({
    width: 800,
    height: 600,
  })
})

test('reports the host display in physical pixels', async () => {
  const host = await page.evaluate(() => window.obsrv.getHostInfo())
  expect(host.physicalWidth).toBeGreaterThan(0)
  expect(host.physicalHeight).toBeGreaterThan(0)
  expect(host.scaleFactor).toBeGreaterThanOrEqual(1)
})

test('settings round-trip, and impossible values are refused', async () => {
  const saved = await page.evaluate(async () => {
    await window.obsrv.setSettings({ hostDiagonalInches: 32, hostNits: 400 })
    return window.obsrv.getSettings()
  })
  expect(saved).toEqual({ hostDiagonalInches: 32, hostNits: 400 })

  const outcome = await page.evaluate(async () => {
    try {
      await window.obsrv.setSettings({ hostDiagonalInches: 0, hostNits: 400 })
      return 'accepted'
    } catch {
      return 'rejected'
    }
  })
  expect(outcome).toBe('rejected')

  // The rejected write must not have clobbered the stored value.
  expect(await page.evaluate(() => window.obsrv.getSettings())).toEqual({
    hostDiagonalInches: 32,
    hostNits: 400,
  })
})

test('the renderer takes over native pane layout for good', async () => {
  await page.evaluate(() => window.obsrv.setNativeBounds({ x: 10, y: 50, width: 300, height: 200 }))
  await new Promise(r => setTimeout(r, 200))

  const seen = await app.evaluate(async () => {
    const ctx = (globalThis as any).__obsrv
    const set = ctx.native.getBounds()
    ctx.win.setContentSize(1200, 800)
    await new Promise(r => setTimeout(r, 300))
    return { set, afterResize: ctx.native.getBounds() }
  })

  expect(seen.set).toEqual({ x: 10, y: 50, width: 300, height: 200 })
  // Main's fallback layout must not fight the renderer once it has spoken.
  expect(seen.afterResize).toEqual(seen.set)
})

test('image mode hides the native pane and stops target frames', async () => {
  // Enter image mode *before* subscribing: the subscription handshake would
  // otherwise open the gate and deliver its own full frame before the mode
  // switch lands, and "no frames in image mode" would depend on ordering.
  await page.evaluate(() => {
    window.obsrv.setMode('image')
    const w = window as any
    w.__frames = []
    w.__off = window.obsrv.onFrame(() => w.__frames.push(1))
  })
  await new Promise(r => setTimeout(r, 200))

  const visibleInImageMode = await app.evaluate(async () => {
    const ctx = (globalThis as any).__obsrv
    ctx.target.invalidate()
    await new Promise(r => setTimeout(r, 500))
    return ctx.native.isVisible()
  })
  expect(visibleInImageMode).toBe(false)
  expect(await page.evaluate(() => (window as any).__frames.length)).toBe(0)

  await page.evaluate(() => window.obsrv.setMode('url'))
  await new Promise(r => setTimeout(r, 500))

  expect(await app.evaluate(() => (globalThis as any).__obsrv.native.isVisible())).toBe(true)
  expect(await page.evaluate(() => (window as any).__frames.length)).toBeGreaterThan(0)

  await page.evaluate(() => (window as any).__off())
})

test('ignores malformed payloads', async () => {
  const before = await app.evaluate(() => (globalThis as any).__obsrv.native.getBounds())

  await page.evaluate(async () => {
    const api = window.obsrv as any
    api.setNativeBounds({})
    api.sendInput({ type: 'nope' })
    api.setMode('bogus')
    await api.setSettings({ hostDiagonalInches: 27, hostNits: 500, extra: 1 })
  })
  await new Promise(r => setTimeout(r, 200))

  const after = await app.evaluate(() => {
    const ctx = (globalThis as any).__obsrv
    return { bounds: ctx.native.getBounds(), visible: ctx.native.isVisible() }
  })
  expect(after.bounds).toEqual(before)
  expect(after.visible).toBe(true)

  const settings = await page.evaluate(() => window.obsrv.getSettings())
  expect(settings).toEqual({ hostDiagonalInches: 27, hostNits: 500 })
  expect(Object.keys(settings)).toHaveLength(2)

  // Main is still alive and answering.
  expect(await page.evaluate(() => window.obsrv.setViewport(640, 480))).toEqual({ width: 640, height: 480 })
})
