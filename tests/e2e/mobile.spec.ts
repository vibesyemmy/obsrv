import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { launchApp, rendererWindow } from './launch'

const RESPONSIVE = pathToFileURL(resolve(__dirname, '../fixtures/responsive.html')).href
const NO_VIEWPORT = pathToFileURL(resolve(__dirname, '../fixtures/no-viewport.html')).href
const BUTTON = pathToFileURL(resolve(__dirname, '../fixtures/button.html')).href

let app: ElectronApplication
let page: Page

/**
 * Mobile presets drive the whole pipeline from the toolbar: selecting one
 * recreates the offscreen window at the device's real scale factor (the
 * offscreen dsf is fixed at creation), swaps in a mobile UA, and re-applies
 * mobile device emulation on every navigation. These specs assert each layer:
 * frame dims (CSS x dsf), in-page devicePixelRatio, viewport-meta vs 980px
 * layout, UA on target-not-native, input mapping through the scaled canvas,
 * and full restoration on the way back to a desktop preset.
 */
async function installFrameHelper(a: ElectronApplication): Promise<void> {
  await a.evaluate(() => {
    ;(globalThis as any).__waitForFrame = (target: any, matches: (f: any) => boolean, label: string) =>
      new Promise<any>((res, rej) => {
        const timer = setTimeout(() => {
          target.off('frame', onFrame)
          rej(new Error(`no ${label} paint within 10s`))
        }, 10_000)
        const onFrame = (f: any): void => {
          if (!matches(f)) return
          clearTimeout(timer)
          target.off('frame', onFrame)
          res(f)
        }
        target.on('frame', onFrame)
      })
  })
}

/** The target page's value for `expr`, or `fallback` while it is mid-navigation. */
async function inTarget(expr: string, fallback: unknown = null): Promise<unknown> {
  return app.evaluate(
    async (_e, arg: { expr: string; fallback: unknown }) => {
      const ctx = (globalThis as any).__obsrv
      try {
        return await ctx.target.webContents.executeJavaScript(arg.expr)
      } catch {
        return arg.fallback
      }
    },
    { expr, fallback },
  )
}

test.beforeAll(async () => {
  app = await launchApp()
  page = await rendererWindow(app)
  await installFrameHelper(app)
})
test.afterAll(async () => {
  await app.close()
})

test('iPhone preset rasterises at 3x: frames are CSS×3 and the page sees dpr 3', async () => {
  await page.selectOption('.preset-select', 'iphone-61')

  // The recreated window reports the device's dpr once its reload commits.
  await expect.poll(() => inTarget('devicePixelRatio', 0)).toBe(3)

  const f = await app.evaluate(async () => {
    const ctx = (globalThis as any).__obsrv
    const painted = (globalThis as any).__waitForFrame(
      ctx.target,
      (m: any) => m.frameWidth === 1179 && m.frameHeight === 2556,
      '1179x2556',
    )
    ctx.target.invalidate()
    const m = await painted
    return { width: m.frameWidth, height: m.frameHeight, dsf: ctx.target.getDeviceScaleFactor() }
  })
  expect(f).toEqual({ width: 1179, height: 2556, dsf: 3 })

  // The footer states the density and the per-device-pixel magnification.
  await expect(page.locator('.target-pane .pane-footer')).toContainText('393×852 @3x')
})

test('a page with a viewport meta lays out at the preset CSS width', async () => {
  await page.evaluate(u => window.obsrv.navigate(u), RESPONSIVE)
  await expect
    .poll(() => app.evaluate(() => (globalThis as any).__obsrv.target.webContents.getURL()))
    .toBe(RESPONSIVE)

  await expect.poll(() => inTarget('innerWidth', 0)).toBe(393)
  // The phone-width media query is live, not just the raw viewport number.
  await expect.poll(() => inTarget('matchMedia("(max-width: 500px)").matches', false)).toBe(true)
})

test('the target wears a mobile UA; the native pane keeps its desktop one', async () => {
  const uas = await app.evaluate(() => {
    const ctx = (globalThis as any).__obsrv
    return {
      target: ctx.target.webContents.getUserAgent(),
      native: ctx.native.webContents.getUserAgent(),
    }
  })
  expect(uas.target).toContain('Android')
  expect(uas.target).toContain('Mobile')
  expect(uas.native).not.toContain('Android')
  expect(uas.native).not.toContain('Mobile')

  // The page itself sees the mobile UA, not just future requests.
  await expect.poll(() => inTarget('navigator.userAgent', '')).toContain('Android')
})

test('without a viewport meta the page lays out at the 980px virtual viewport', async () => {
  await page.evaluate(u => window.obsrv.navigate(u), NO_VIEWPORT)
  await expect
    .poll(() => app.evaluate(() => (globalThis as any).__obsrv.target.webContents.getURL()))
    .toBe(NO_VIEWPORT)

  await expect.poll(() => inTarget('document.documentElement.clientWidth', 0)).toBe(980)
  // …zoomed out to fit the 393-CSS-px view, exactly as a phone shows it.
  await expect.poll(() => inTarget('Math.round(visualViewport.scale * 1000)', 0)).toBe(
    Math.round((393 / 980) * 1000),
  )
})

test('a click on the canvas lands on the page through the device-pixel scale', async () => {
  await page.evaluate(u => window.obsrv.navigate(u), BUTTON)
  await expect
    .poll(() => app.evaluate(() => (globalThis as any).__obsrv.target.webContents.getTitle()))
    .toBe('ready')
  // The click must hit painted pixels, not a mid-navigation blank.
  await app.evaluate(async () => {
    const ctx = (globalThis as any).__obsrv
    const painted = (globalThis as any).__waitForFrame(ctx.target, () => true, 'button page')
    ctx.target.invalidate()
    await painted
  })

  // The button fills the whole viewport, so any canvas point that maps inside
  // the page works; near the origin stays visible however small S gets.
  const box = await page.locator('.target-canvas').boundingBox()
  if (!box) throw new Error('target canvas not visible')
  await page.mouse.click(box.x + 20, box.y + 20)

  await expect
    .poll(() => app.evaluate(() => (globalThis as any).__obsrv.target.webContents.getTitle()))
    .toBe('clicked')
})

test('switching back to a desktop preset restores 1x frames, dpr 1 and the desktop UA', async () => {
  await page.selectOption('.preset-select', '1080p-24')

  await expect.poll(() => inTarget('devicePixelRatio', 0)).toBe(1)

  const f = await app.evaluate(async () => {
    const ctx = (globalThis as any).__obsrv
    const painted = (globalThis as any).__waitForFrame(
      ctx.target,
      (m: any) => m.frameWidth === 1920 && m.frameHeight === 1080,
      '1920x1080',
    )
    ctx.target.invalidate()
    const m = await painted
    return {
      width: m.frameWidth,
      height: m.frameHeight,
      dsf: ctx.target.getDeviceScaleFactor(),
      ua: ctx.target.webContents.getUserAgent(),
      url: ctx.target.webContents.getURL(),
    }
  })
  expect(f.width).toBe(1920)
  expect(f.height).toBe(1080)
  expect(f.dsf).toBe(1)
  expect(f.ua).not.toContain('Android')
  expect(f.ua).not.toContain('Mobile')
  // The recreation restored the page the target was showing.
  expect(f.url).toBe(BUTTON)

  // Desktop layout again: no 980px virtual viewport, no emulation left over.
  await expect.poll(() => inTarget('document.documentElement.clientWidth', 0)).toBe(1920)
  await expect(page.locator('.target-pane .pane-footer')).not.toContainText('@3x')
})
