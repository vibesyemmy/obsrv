import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { launchApp, rendererWindow } from './launch'
import { choose } from './helpers/select'

const RESPONSIVE = pathToFileURL(resolve(__dirname, '../fixtures/responsive.html')).href
const NO_VIEWPORT = pathToFileURL(resolve(__dirname, '../fixtures/no-viewport.html')).href
const BUTTON = pathToFileURL(resolve(__dirname, '../fixtures/button.html')).href

let app: ElectronApplication
let page: Page

/**
 * Mobile presets drive the whole pipeline from the toolbar: selecting one
 * recreates the offscreen window at the device's real scale factor (the
 * offscreen dsf is fixed at creation), swaps in a mobile UA, and re-applies
 * mobile device emulation on every navigation. These specs assert each layer —
 * frame dims (CSS x dsf), in-page devicePixelRatio, viewport-meta vs 980px
 * layout, UA on target-not-native, input mapping through the scaled canvas,
 * restoration on the way back to a desktop preset — plus the recreation
 * races: rapid density switches, a navigation issued mid-swap, destruction
 * mid-swap. Each test selects its own preset, so they run standalone.
 */
async function installFrameHelper(a: ElectronApplication): Promise<void> {
  await a.evaluate(() => {
    ;(globalThis as any).__waitForFrame = (target: any, matches: (f: any) => boolean, _label: string) =>
      new Promise<any>(res => {
        // Resolves null on timeout rather than rejecting. A rejection that
        // lands after its test has already timed out is reported by
        // Playwright as an error outside any test, and that fails the run
        // even when every test passed (it did, at v0.18.3). The caller
        // returns null in its turn and the spec asserts on it.
        const timer = setTimeout(() => {
          target.off('frame', onFrame)
          res(null)
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

/** Picks a preset in the toolbar and waits for its density to be live. */
async function selectPreset(id: string, dpr: number): Promise<void> {
  await choose(app, page, '.preset-select', id)
  await expect.poll(() => inTarget('devicePixelRatio', 0)).toBe(dpr)
}

async function targetUrl(): Promise<string> {
  return app.evaluate(() => (globalThis as any).__obsrv.target.webContents.getURL())
}

async function targetTitle(): Promise<string> {
  return app.evaluate(() => (globalThis as any).__obsrv.target.webContents.getTitle())
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
  await selectPreset('iphone-61', 3)

  const f = await app.evaluate(async () => {
    const ctx = (globalThis as any).__obsrv
    const painted = (globalThis as any).__waitForFrame(
      ctx.target,
      (m: any) => m.frameWidth === 1179 && m.frameHeight === 2556,
      '1179x2556',
    )
    ctx.target.invalidate()
    const m = await painted
    if (!m) return null
    return { width: m.frameWidth, height: m.frameHeight, dsf: ctx.target.getDeviceScaleFactor() }
  })
  if (!f) throw new Error('no 1179x2556 paint within 10s')
  expect(f).toEqual({ width: 1179, height: 2556, dsf: 3 })

  // The footer states the density and the per-device-pixel magnification.
  await expect(page.locator('.target-pane .pane-footer')).toContainText('393×852 @3x')
})

test('a page with a viewport meta lays out at the preset CSS width', async () => {
  await selectPreset('iphone-61', 3)
  await page.evaluate(u => window.obsrv.navigate(u), RESPONSIVE)
  await expect.poll(targetUrl).toBe(RESPONSIVE)

  await expect.poll(() => inTarget('innerWidth', 0)).toBe(393)
  // The phone-width media query is live, not just the raw viewport number.
  await expect.poll(() => inTarget('matchMedia("(max-width: 500px)").matches', false)).toBe(true)
})

test('the target wears a mobile UA; the native pane keeps its desktop one', async () => {
  await selectPreset('iphone-61', 3)
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
  await selectPreset('iphone-61', 3)
  await page.evaluate(u => window.obsrv.navigate(u), NO_VIEWPORT)
  await expect.poll(targetUrl).toBe(NO_VIEWPORT)

  await expect.poll(() => inTarget('document.documentElement.clientWidth', 0)).toBe(980)
  // …zoomed out to fit the 393-CSS-px view, exactly as a phone shows it.
  await expect.poll(() => inTarget('Math.round(visualViewport.scale * 1000)', 0)).toBe(
    Math.round((393 / 980) * 1000),
  )
})

test('a click on the canvas lands on the page through the device-pixel scale', async () => {
  await selectPreset('iphone-61', 3)
  await page.evaluate(u => window.obsrv.navigate(u), BUTTON)
  await expect.poll(targetTitle).toBe('ready')
  // The click must hit painted pixels, not a mid-navigation blank.
  const buttonPainted = await app.evaluate(async () => {
    const ctx = (globalThis as any).__obsrv
    const painted = (globalThis as any).__waitForFrame(ctx.target, () => true, 'button page')
    ctx.target.invalidate()
    return (await painted) !== null
  })
  if (!buttonPainted) throw new Error('no button page paint within 10s')

  // The button fills the whole viewport, so any canvas point that maps inside
  // the page works; near the origin stays visible however small S gets.
  const box = await page.locator('.target-canvas').boundingBox()
  if (!box) throw new Error('target canvas not visible')
  await page.mouse.click(box.x + 20, box.y + 20)

  await expect.poll(targetTitle).toBe('clicked')
})

test('switching back to a desktop preset restores 1x frames, dpr 1 and the desktop UA', async () => {
  await selectPreset('iphone-61', 3)
  await page.evaluate(u => window.obsrv.navigate(u), BUTTON)
  await expect.poll(targetUrl).toBe(BUTTON)

  await selectPreset('1080p-24', 1)

  const f = await app.evaluate(async () => {
    const ctx = (globalThis as any).__obsrv
    const painted = (globalThis as any).__waitForFrame(
      ctx.target,
      (m: any) => m.frameWidth === 1920 && m.frameHeight === 1080,
      '1920x1080',
    )
    ctx.target.invalidate()
    const m = await painted
    if (!m) return null
    return {
      width: m.frameWidth,
      height: m.frameHeight,
      dsf: ctx.target.getDeviceScaleFactor(),
      ua: ctx.target.webContents.getUserAgent(),
      url: ctx.target.webContents.getURL(),
    }
  })
  if (!f) throw new Error('no 1920x1080 paint within 10s')
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

test('rapid density switches land on the final preset with the page intact', async () => {
  await selectPreset('1080p-24', 1)
  await page.evaluate(u => window.obsrv.navigate(u), BUTTON)
  await expect.poll(targetTitle).toBe('ready')

  // Back-to-back, no waiting between them: the second recreation starts
  // before the first one's restore has committed. The intended URL must
  // survive the pile-up — reading it off the dying (mid-recreation) window
  // would see about:blank and silently blank the target.
  await choose(app, page, '.preset-select', 'iphone-61')
  await choose(app, page, '.preset-select', 'android-65')

  await expect.poll(() => inTarget('devicePixelRatio', 0)).toBe(2)
  const f = await app.evaluate(async () => {
    const ctx = (globalThis as any).__obsrv
    const painted = (globalThis as any).__waitForFrame(
      ctx.target,
      (m: any) => m.frameWidth === 720 && m.frameHeight === 1600,
      '720x1600',
    )
    ctx.target.invalidate()
    const m = await painted
    if (!m) return null
    return { width: m.frameWidth, height: m.frameHeight, dsf: ctx.target.getDeviceScaleFactor() }
  })
  if (!f) throw new Error('no 720x1600 paint within 10s')
  expect(f).toEqual({ width: 720, height: 1600, dsf: 2 })

  // The page, not just the surface: still the button fixture, fully loaded.
  await expect.poll(targetUrl).toBe(BUTTON)
  await expect.poll(targetTitle).toBe('ready')
  await expect.poll(() => inTarget("document.querySelector('button') !== null", false)).toBe(true)
})

test('a navigation issued mid-recreation lands on the new window', async () => {
  await selectPreset('1080p-27', 1)
  await page.evaluate(u => window.obsrv.navigate(u), BUTTON)
  await expect.poll(targetUrl).toBe(BUTTON)

  // Change density and navigate immediately — the load()'s window can be
  // destroyed under it, so the recorded intent, not the old window's URL,
  // must decide what the fresh window shows.
  await choose(app, page, '.preset-select', 'iphone-61')
  await page.evaluate(u => window.obsrv.navigate(u), RESPONSIVE)

  await expect.poll(targetUrl).toBe(RESPONSIVE)
  await expect.poll(() => inTarget('devicePixelRatio', 0)).toBe(3)
  await expect.poll(() => inTarget('innerWidth', 0)).toBe(393)
})

test('destroying the source mid-recreation neither throws nor kills main', async () => {
  const survived = await app.evaluate(async () => {
    const ctx = (globalThis as any).__obsrv
    // A second, throwaway TargetSource — same class the app runs.
    const TS = ctx.target.constructor as new () => any
    const t = new TS()
    try {
      // Recreation before the first window's gate has settled…
      t.setViewport(375, 667, 2)
      // …and destruction while that recreation is still in flight.
      t.destroy()
      // load() waits on the (settled-by-destruction) gate; resolving without
      // throwing proves the pending recreation continuation bailed cleanly.
      const echoed = await t.load('about:blank')
      return echoed === 'about:blank'
    } catch {
      return false
    }
  })
  expect(survived).toBe(true)

  // Main is still alive and serving IPC.
  const host = await page.evaluate(() => window.obsrv.getHostInfo())
  expect(host.scaleFactor).toBeGreaterThan(0)
})
