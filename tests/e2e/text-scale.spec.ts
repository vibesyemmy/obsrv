import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { choose } from './helpers/select'
import { launchApp, rendererWindow } from './launch'

/**
 * Text scale is browser zoom as reflow: the page must see a CSS viewport
 * `1/scale` the size of the screen at `scale` times the density — what a
 * user at 150 % sees — while the surface itself, the native pane and the
 * other tabs stay exactly as they were. Measured from inside the page, since
 * that is the only vantage point that can tell reflow from magnification.
 */

let app: ElectronApplication
let page: Page
let server: Server
let url: string

const PAGE =
  '<!doctype html><title>scale</title><meta name="viewport" content="width=device-width">' +
  '<style>body{margin:0;font:16px/1.2 sans-serif}#box{width:120px;height:40px;background:#000;color:#fff}</style>' +
  '<div id="box">box</div><p id="text">text</p>'

interface View {
  innerWidth: number
  innerHeight: number
  dpr: number
  screenWidth: number
}

const VIEW = '({ innerWidth, innerHeight, dpr: devicePixelRatio, screenWidth: screen.width })'

const viewIn = (a: ElectronApplication, pane: 'target' | 'native'): Promise<View> =>
  a.evaluate(({}, [code, which]: [string, string]) => (globalThis as any).__obsrv[which].webContents.executeJavaScript(code), [VIEW, pane] as [string, string])
const targetView = (): Promise<View> => viewIn(app, 'target')
const nativeView = (): Promise<View> => viewIn(app, 'native')
const setScale = (scale: number): Promise<void> =>
  app.evaluate(({}, s: number) => (globalThis as any).__obsrv.target.setTextScale(s), scale)
const footer = (): Promise<string> => page.locator('.target-pane .pane-footer').innerText()

test.beforeAll(async () => {
  server = createServer((_req, res) => {
    res.setHeader('Content-Type', 'text/html')
    res.end(PAGE)
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`
  app = await launchApp()
  page = await rendererWindow(app)
  await page.fill('.url-form input', url)
  await page.press('.url-form input', 'Enter')
  await expect.poll(() => targetView().then(v => v.innerWidth), { timeout: 10_000 }).toBe(1920)
})
test.afterAll(async () => {
  await app.close()
  await new Promise<void>(r => server.close(() => r()))
})

test('×1.5 on the 1080p desktop: the page sees 1280×720 at 1.5x; the surface and the native pane do not move', async () => {
  const nativeBefore = await nativeView()
  await setScale(1.5)
  await expect.poll(targetView, { timeout: 5_000 }).toEqual({ innerWidth: 1280, innerHeight: 720, dpr: 1.5, screenWidth: 1280 })
  // The surface is still the screen: 1920×1080 CSS px at 1x.
  expect(await app.evaluate(() => (globalThis as any).__obsrv.target.getViewport())).toEqual({ width: 1920, height: 1080 })
  const shot = await app.evaluate(async () => {
    const img = await (globalThis as any).__obsrv.target.webContents.capturePage()
    return img.getSize()
  })
  expect(shot).toEqual({ width: 1920, height: 1080 })
  // A 120 CSS px box is 180 device px wide now — reflow, not a magnified bitmap.
  const box = await app.evaluate(() =>
    (globalThis as any).__obsrv.target.webContents.executeJavaScript(
      '(() => { const r = document.getElementById("box").getBoundingClientRect(); return { w: r.width * devicePixelRatio, h: r.height * devicePixelRatio } })()',
    ),
  )
  expect(box).toEqual({ w: 180, h: 60 })
  expect(await nativeView()).toEqual(nativeBefore)
})

test('the scale survives a navigation', async () => {
  await page.fill('.url-form input', `${url}?again`)
  await page.press('.url-form input', 'Enter')
  await expect.poll(
    () => app.evaluate(() => (globalThis as any).__obsrv.target.webContents.getURL()),
    { timeout: 10_000 },
  ).toContain('?again')
  await expect.poll(targetView, { timeout: 5_000 }).toEqual({ innerWidth: 1280, innerHeight: 720, dpr: 1.5, screenWidth: 1280 })
})

test('back to ×1 is the plain page again, emulation off', async () => {
  await setScale(1)
  await expect.poll(targetView, { timeout: 5_000 }).toEqual({ innerWidth: 1920, innerHeight: 1080, dpr: 1, screenWidth: 1920 })
})

test('inspect maps surface points into the scaled page and boxes back out', async () => {
  await setScale(2)
  await expect.poll(targetView, { timeout: 5_000 }).toMatchObject({ innerWidth: 960, dpr: 2 })
  // The box is 120×40 page px = 240×80 surface px at the origin; a surface
  // point at (200, 60) is inside it, and its rect comes back in surface px.
  const report = await app.evaluate(() => (globalThis as any).__obsrv.target.inspectAt(200, 60))
  expect(report).toMatchObject({ id: 'box', fontSizePx: 16 })
  expect(report.rect).toEqual({ x: 0, y: 0, width: 240, height: 80 })
  await setScale(1)
})

test('the toolbar menu sets it, the footer states it, and ×1 states nothing', async () => {
  await expect(page.locator('.text-scale-select')).toHaveAttribute('data-value', '1')
  await expect(page.locator('.text-scale-select')).toHaveText(/Text 100%/)
  expect(await footer()).not.toContain('text ')

  await choose(app, page, '.text-scale-select', '1.5')
  await expect(page.locator('.text-scale-select')).toHaveText(/Text 150%/)
  await expect.poll(footer).toContain('text 150%')
  await expect.poll(targetView, { timeout: 5_000 }).toMatchObject({ innerWidth: 1280, dpr: 1.5 })

  await choose(app, page, '.text-scale-select', '1')
  await expect.poll(footer).not.toContain('text ')
  await expect.poll(targetView, { timeout: 5_000 }).toMatchObject({ innerWidth: 1920, dpr: 1 })
})

test('on a phone preset the scale composes with the mobile emulation', async () => {
  await choose(app, page, '.preset-select', 'iphone-61')
  await expect.poll(targetView, { timeout: 10_000 }).toMatchObject({ innerWidth: 393, dpr: 3 })
  await choose(app, page, '.text-scale-select', '2')
  await expect.poll(targetView, { timeout: 10_000 }).toEqual({ innerWidth: 197, innerHeight: 426, dpr: 6, screenWidth: 197 })
  // Still a phone: the mobile user agent is the window's, untouched by the scale.
  expect(await app.evaluate(() => (globalThis as any).__obsrv.target.webContents.getUserAgent())).toContain('Mobile')
  await choose(app, page, '.text-scale-select', '1')
  await choose(app, page, '.preset-select', '1080p-24')
  await expect.poll(targetView, { timeout: 10_000 }).toMatchObject({ innerWidth: 1920, dpr: 1 })
})

test('the scale is per tab', async () => {
  await choose(app, page, '.text-scale-select', '1.5')
  await expect.poll(targetView, { timeout: 5_000 }).toMatchObject({ innerWidth: 1280 })
  await page.locator('.chrome-tabs .tab-new').click()
  await expect(page.locator('.chrome-tabs [role="tab"]')).toHaveCount(2)
  await expect(page.locator('.text-scale-select')).toHaveAttribute('data-value', '1')
  await page.locator('.chrome-tabs [role="tab"]').nth(0).click()
  await expect(page.locator('.text-scale-select')).toHaveAttribute('data-value', '1.5')
  await expect.poll(targetView, { timeout: 5_000 }).toMatchObject({ innerWidth: 1280 })
  await choose(app, page, '.text-scale-select', '1')
})

test.describe('the scale survives a relaunch', () => {
  const dirs: string[] = []
  const dir = (): string => {
    const d = mkdtempSync(join(tmpdir(), 'obsrv-text-scale-'))
    dirs.push(d)
    return d
  }
  test.afterAll(() => {
    while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true })
  })

  test('a scaled tab comes back scaled, laid out at its scale from the first paint', async () => {
    const home = dir()
    const first = await launchApp([], {}, home)
    const p1 = await rendererWindow(first)
    await p1.evaluate(u => window.obsrv.navigate(u), url)
    await expect.poll(() => viewIn(first, 'target').then(v => v.innerWidth), { timeout: 10_000 }).toBe(1920)
    await choose(first, p1, '.text-scale-select', '1.5')
    await expect.poll(() => viewIn(first, 'target').then(v => v.innerWidth), { timeout: 5_000 }).toBe(1280)
    await expect.poll(() => existsSync(join(home, 'tabs.json')), { timeout: 5_000 }).toBe(true)
    await expect
      .poll(() => JSON.parse(readFileSync(join(home, 'tabs.json'), 'utf8')).tabs[0].textScale, { timeout: 5_000 })
      .toBe(1.5)
    await first.close()

    const second = await launchApp([], {}, home)
    const p2 = await rendererWindow(second)
    await expect(p2.locator('.text-scale-select')).toHaveAttribute('data-value', '1.5', { timeout: 10_000 })
    await expect.poll(() => viewIn(second, 'target'), { timeout: 10_000 }).toMatchObject({ innerWidth: 1280, dpr: 1.5 })
    await second.close()
  })
})
