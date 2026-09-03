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

// A black box at the origin and a red square pinned to the far corner: the
// painted frame is checked at both ends, since the page's own arithmetic
// cannot tell whether the compositor drew it at the scale it was told.
const PAGE =
  '<!doctype html><title>scale</title><meta name="viewport" content="width=device-width">' +
  '<style>html,body{margin:0;background:#00f}body{font:16px/1.2 sans-serif}#box{width:120px;height:40px;background:#000;color:#fff}' +
  '#corner{position:fixed;right:0;bottom:0;width:50px;height:50px;background:#f00}</style>' +
  // No text in the box: the frame probe scans a row of it for its edge.
  '<div id="box"></div><p id="text">text</p><div id="corner"></div>'

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

interface FrameProbe {
  full: string
  boxWidthDevicePx: number
  /** RGB at the frame's far corner: red when the page's corner element reaches it. */
  corner: number[]
  /** RGB across the box's right edge: black, black, blue, blue when the raster is sharp. */
  edge: number[][]
}

/**
 * One painted frame, read as pixels: where the black box ends on row 20,
 * what sits in the far corner, and whether the box's edge is a hard step.
 * This is the surface the user sees and the CLI writes — the only place a
 * layout-only emulation shows up as a page in the top-left corner.
 */
const frameProbe = (): Promise<FrameProbe> =>
  app.evaluate(async () => {
    const ctx = (globalThis as any).__obsrv
    const got: any = await new Promise(resolve => {
      ctx.target.once('frame', (m: any) => resolve(m))
      ctx.target.webContents.invalidate()
    })
    const { frame, frameWidth, frameHeight } = got
    const data: Uint8Array = frame.data
    const px = (x: number, y: number): number[] => {
      const i = ((y - frame.y) * frame.width + (x - frame.x)) * 4
      return [data[i + 2]!, data[i + 1]!, data[i]!]
    }
    let boxWidthDevicePx = 0
    for (let x = 0; x < frameWidth; x++) {
      const [r, g, b] = px(x, 20)
      if (r! > 40 || g! > 40 || b! > 40) {
        boxWidthDevicePx = x
        break
      }
    }
    return {
      full: `${frameWidth}x${frameHeight}`,
      boxWidthDevicePx,
      corner: px(frameWidth - 5, frameHeight - 5),
      edge: [px(boxWidthDevicePx - 2, 20), px(boxWidthDevicePx - 1, 20), px(boxWidthDevicePx, 20), px(boxWidthDevicePx + 1, 20)],
    }
  })

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

// `capturePage` on the offscreen window answers at the *host display's*
// scale (3840×2160 on a Retina Mac, 1920×1080 on a 1x monitor), whatever
// the target's own density — so the surface check is relative: the capture
// is the same size before and after the scale, never an absolute number.
const shotSize = (): Promise<{ width: number; height: number }> =>
  app.evaluate(async () => {
    const img = await (globalThis as any).__obsrv.target.webContents.capturePage()
    return img.getSize()
  })

test('×1.5 on the 1080p desktop: the page sees 1280×720 at 1.5x; the surface and the native pane do not move', async () => {
  const nativeBefore = await nativeView()
  const shotBefore = await shotSize()
  await setScale(1.5)
  await expect.poll(targetView, { timeout: 5_000 }).toEqual({ innerWidth: 1280, innerHeight: 720, dpr: 1.5, screenWidth: 1280 })
  // The surface is still the screen: 1920×1080 CSS px at 1x, and a capture
  // of it the size it was.
  expect(await app.evaluate(() => (globalThis as any).__obsrv.target.getViewport())).toEqual({ width: 1920, height: 1080 })
  expect(await shotSize()).toEqual(shotBefore)
  // A 120 CSS px box is 180 device px wide now — reflow, not a magnified bitmap.
  const box = await app.evaluate(() =>
    (globalThis as any).__obsrv.target.webContents.executeJavaScript(
      '(() => { const r = document.getElementById("box").getBoundingClientRect(); return { w: r.width * devicePixelRatio, h: r.height * devicePixelRatio } })()',
    ),
  )
  expect(box).toEqual({ w: 180, h: 60 })
  expect(await nativeView()).toEqual(nativeBefore)
})

test('the painted frame is the page at the scale: the box grows, the corner is reached, the edge is sharp', async () => {
  await setScale(1)
  await expect.poll(targetView, { timeout: 5_000 }).toMatchObject({ innerWidth: 1920 })
  await expect.poll(frameProbe, { timeout: 5_000 }).toMatchObject({ full: '1920x1080', boxWidthDevicePx: 120, corner: [255, 0, 0] })
  await setScale(1.5)
  await expect.poll(targetView, { timeout: 5_000 }).toMatchObject({ innerWidth: 1280 })
  // 0.22.0 painted the 1280-wide layout at 1:1 into the top-left corner: the
  // box stayed 120 device px and the far corner showed page background.
  await expect.poll(frameProbe, { timeout: 5_000 }).toEqual({
    full: '1920x1080',
    boxWidthDevicePx: 180,
    corner: [255, 0, 0],
    edge: [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 255],
      [0, 0, 255],
    ],
  })
  await setScale(2)
  await expect.poll(frameProbe, { timeout: 5_000 }).toMatchObject({ boxWidthDevicePx: 240, corner: [255, 0, 0] })
  await setScale(1)
})

test('the scale survives a navigation', async () => {
  // Set here as well as above: a retry runs this in a fresh app.
  await setScale(1.5)
  await expect.poll(targetView, { timeout: 5_000 }).toMatchObject({ innerWidth: 1280 })
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
