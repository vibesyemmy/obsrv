import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { launchApp, rendererWindow } from './launch'

const TALL = pathToFileURL(resolve(__dirname, '../fixtures/tall.html')).href
const HAIRLINE = pathToFileURL(resolve(__dirname, '../fixtures/hairline.html')).href

let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  app = await launchApp()
  page = await rendererWindow(app)
})
test.afterAll(async () => {
  await app.close()
})

/** Scrolls one pane and returns where both panes ended up. */
async function scrollAndRead(
  a: ElectronApplication,
  which: 'native' | 'target',
  y: number,
): Promise<{ native: number; target: number }> {
  return a.evaluate(async (_electron, arg: { which: string; y: number }) => {
    const ctx = (globalThis as any).__obsrv
    const driver = arg.which === 'native' ? ctx.native.webContents : ctx.target.webContents
    await driver.executeJavaScript(`window.scrollTo(0, ${arg.y})`)
    await new Promise(r => setTimeout(r, 600))
    return {
      native: await ctx.native.webContents.executeJavaScript('window.scrollY'),
      target: await ctx.target.webContents.executeJavaScript('window.scrollY'),
    }
  }, { which, y })
}

test('scrolling the native pane moves the target', async () => {
  await page.evaluate(u => window.obsrv.navigate(u), TALL)
  await new Promise(r => setTimeout(r, 500))

  const at = await scrollAndRead(app, 'native', 1200)
  expect(at.native).toBe(1200)
  expect(at.target).toBe(1200)
})

test('scrolling the target moves the native pane', async () => {
  const at = await scrollAndRead(app, 'target', 2400)
  expect(at.target).toBe(2400)
  expect(at.native).toBe(2400)
})

test('repeated scrolls keep tracking, so the bus is not jammed by echoes', async () => {
  const first = await scrollAndRead(app, 'native', 300)
  expect(first.target).toBe(300)

  const second = await scrollAndRead(app, 'native', 900)
  expect(second.target).toBe(900)

  const third = await scrollAndRead(app, 'target', 150)
  expect(third.native).toBe(150)
})

test('navigating the native pane pulls the target along', async () => {
  const urls = await app.evaluate(async (_electron, url: string) => {
    const ctx = (globalThis as any).__obsrv
    await ctx.native.load(url)
    await new Promise(r => setTimeout(r, 800))
    return { native: ctx.native.webContents.getURL(), target: ctx.target.webContents.getURL() }
  }, HAIRLINE)

  expect(urls.native).toBe(HAIRLINE)
  expect(urls.target).toBe(HAIRLINE)
})

test('navigating the target pulls the native pane along', async () => {
  const urls = await app.evaluate(async (_electron, url: string) => {
    const ctx = (globalThis as any).__obsrv
    await ctx.target.load(url)
    await new Promise(r => setTimeout(r, 800))
    return { native: ctx.native.webContents.getURL(), target: ctx.target.webContents.getURL() }
  }, TALL)

  expect(urls.native).toBe(TALL)
  expect(urls.target).toBe(TALL)
})

test('an explicit navigate loads the target exactly once', async () => {
  await app.evaluate(() => {
    const g = globalThis as any
    g.__starts = 0
    g.__count = () => g.__starts++
    g.__obsrv.target.webContents.on('did-start-navigation', g.__count)
  })

  await page.evaluate(u => window.obsrv.navigate(u), HAIRLINE)
  await new Promise(r => setTimeout(r, 1000))

  const starts = await app.evaluate(() => {
    const g = globalThis as any
    g.__obsrv.target.webContents.off('did-start-navigation', g.__count)
    return g.__starts
  })

  // Without SyncBus.expect, the native pane's did-navigate would mirror the
  // same URL into the target a second time.
  expect(starts).toBe(1)
})
