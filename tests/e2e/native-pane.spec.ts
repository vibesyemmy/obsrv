import { test, expect, type ElectronApplication } from '@playwright/test'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { launchApp } from './launch'

const FIXTURE = pathToFileURL(resolve(__dirname, '../fixtures/hairline.html')).href
const TOOLBAR_H = 44

let app: ElectronApplication

test.beforeAll(async () => {
  app = await launchApp()
})
test.afterAll(async () => {
  await app.close()
})

/**
 * The native pane's `WebContentsView` is a second Chromium page target that
 * Playwright discovers exactly like the main `BrowserWindow` does, so
 * `app.firstWindow()` races between the two and can resolve to either one.
 * Select the renderer's own window by URL instead of trusting arrival order.
 */
async function rendererWindow(electronApp: ElectronApplication) {
  const existing = electronApp.windows().find(w => w.url().endsWith('/renderer/index.html'))
  return existing ?? electronApp.waitForEvent('window', w => w.url().endsWith('/renderer/index.html'))
}

test('main window opens with the renderer loaded', async () => {
  const page = await rendererWindow(app)
  await expect(page.locator('#root')).toContainText('Obsrv')
})

test('native pane loads a URL', async () => {
  const title = await app.evaluate(async (_electron, url: string) => {
    const ctx = (globalThis as any).__obsrv
    await ctx.native.load(url)
    return ctx.native.webContents.getTitle()
  }, FIXTURE)
  expect(title).toBe('hairline-fixture')
})

test('native pane fills the left half below the toolbar', async () => {
  const seen = await app.evaluate(async () => {
    const ctx = (globalThis as any).__obsrv
    const [width = 0, height = 0] = ctx.win.getContentSize()
    return { bounds: ctx.native.getBounds(), content: { width, height } }
  })
  expect(seen.bounds.x).toBe(0)
  expect(seen.bounds.y).toBe(TOOLBAR_H)
  expect(seen.bounds.width).toBe(Math.floor(seen.content.width / 2))
  expect(seen.bounds.height).toBe(seen.content.height - TOOLBAR_H)
})

test('back returns to the previous document', async () => {
  const landed = await app.evaluate(async (_electron, url: string) => {
    const ctx = (globalThis as any).__obsrv
    await ctx.native.load('about:blank')
    await ctx.native.load(url)
    const wc = ctx.native.webContents
    const navigated = new Promise<string>(res => {
      wc.once('did-navigate', (_e: unknown, u: string) => res(u))
    })
    ctx.native.back()
    return navigated
  }, FIXTURE)
  expect(landed).toBe('about:blank')
})
