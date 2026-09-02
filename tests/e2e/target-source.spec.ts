import { test, expect, type ElectronApplication } from '@playwright/test'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { launchApp } from './launch'

const FIXTURE = pathToFileURL(resolve(__dirname, '../fixtures/hairline.html')).href

let app: ElectronApplication

/**
 * Installs `globalThis.__waitForFrame(target, matches, label)` in main: it
 * resolves with the first `frame` event `matches` accepts, or with null after
 * 10 s (never a rejection — see inside). Playwright serialises each `evaluate` callback's source, so a
 * helper defined in this file would not exist inside main — it is installed
 * once per app instead.
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

test.beforeAll(async () => {
  // Force a 2x host so the 1x assertion below discriminates on any machine:
  // on a 1x host (or a Retina Mac in clamshell on 1x externals) it would pass
  // trivially. Chromium applies this to every surface except an offscreen
  // one with an explicit `deviceScaleFactor`, which is exactly the claim.
  app = await launchApp(['--force-device-scale-factor=2'])
  await installFrameHelper(app)
})
test.afterAll(async () => {
  await app.close()
})

test('rasterises at 1x: frame size equals the CSS viewport', async () => {
  const seen = await app.evaluate(async ({ screen }, url: string) => {
    const ctx = (globalThis as any).__obsrv
    const hostScale = screen.getPrimaryDisplay().scaleFactor
    await ctx.target.load(url)
    ctx.target.setViewport(1366, 768)
    const f = await (globalThis as any).__waitForFrame(
      ctx.target,
      (m: any) => m.frameWidth === 1366 && m.frameHeight === 768,
      '1366x768',
    )
    if (!f) return null
    return {
      hostScale,
      frameWidth: f.frameWidth,
      frameHeight: f.frameHeight,
      sliceBytes: f.frame.data.length,
      expectedBytes: f.frame.width * f.frame.height * 4,
    }
  }, FIXTURE)
  if (!seen) throw new Error('no 1366x768 paint within 10s')

  // The forced host scale must have taken, or the assertion proves nothing.
  expect(seen.hostScale).toBe(2)
  // On a 2x host an ordinary view would report 2732x1536 here.
  expect(seen.frameWidth).toBe(1366)
  expect(seen.frameHeight).toBe(768)
  // BGRA, row-major, no row padding.
  expect(seen.sliceBytes).toBe(seen.expectedBytes)
})

test('frame bytes are BGRA of the rendered page', async () => {
  const px = await app.evaluate(async () => {
    const ctx = (globalThis as any).__obsrv
    const html = '<body style="margin:0;background:#ff0000">'
    // Load first, resize second: the resize repaint is then already red, so
    // the first 200x100 frame cannot be a stale paint of the previous page.
    await ctx.target.load('data:text/html,' + encodeURIComponent(html))
    ctx.target.setViewport(200, 100)
    const f = await (globalThis as any).__waitForFrame(
      ctx.target,
      (m: any) => m.frameWidth === 200 && m.frameHeight === 100,
      '200x100',
    )
    if (!f) return null
    const d = f.frame.data
    return { x: f.frame.x, y: f.frame.y, b: d[0], g: d[1], r: d[2], a: d[3] }
  })

  if (!px) throw new Error('no 200x100 paint within 10s')
  expect(px).toEqual({ x: 0, y: 0, b: 0, g: 0, r: 255, a: 255 })
})

test('emits a partial dirty rect when a small element changes', async () => {
  const seen = await app.evaluate(async () => {
    const ctx = (globalThis as any).__obsrv
    const wait = (globalThis as any).__waitForFrame
    const html =
      '<body style="margin:0;background:#ffffff">' +
      '<div id="b" style="position:absolute;left:100px;top:100px;width:20px;height:20px;background:#ffffff"></div>'
    await ctx.target.load('data:text/html,' + encodeURIComponent(html))
    ctx.target.setViewport(400, 300)
    // Settle on a full-frame paint of the white page at the new size first.
    await wait(
      ctx.target,
      (m: any) =>
        m.frameWidth === 400 && m.frameHeight === 300 && m.frame.width === 400 && m.frame.height === 300,
      'full 400x300',
    )
    const partial = wait(
      ctx.target,
      (m: any) => !(m.frame.width === 400 && m.frame.height === 300),
      'partial',
    )
    await ctx.target.webContents.executeJavaScript(
      'document.getElementById("b").style.background = "#ff0000"; true',
    )
    const f = await partial
    const { x, y, width, height, data } = f.frame
    // Sample the element's centre (110,110) in slice-local coordinates.
    const i = ((110 - y) * width + (110 - x)) * 4
    return {
      rect: { x, y, width, height },
      frame: { w: f.frameWidth, h: f.frameHeight },
      bytes: data.length,
      px: [data[i], data[i + 1], data[i + 2], data[i + 3]],
    }
  })

  expect(seen.frame).toEqual({ w: 400, h: 300 })
  // Not the full frame, but covering the 20x20 element at (100,100).
  expect(seen.rect.width * seen.rect.height).toBeLessThan(400 * 300)
  expect(seen.rect.x).toBeLessThanOrEqual(100)
  expect(seen.rect.y).toBeLessThanOrEqual(100)
  expect(seen.rect.x + seen.rect.width).toBeGreaterThanOrEqual(120)
  expect(seen.rect.y + seen.rect.height).toBeGreaterThanOrEqual(120)
  expect(seen.bytes).toBe(seen.rect.width * seen.rect.height * 4)
  // Red in BGRA.
  expect(seen.px).toEqual([0, 0, 255, 255])
})

test('viewport clamps to MAX_VIEWPORT and reports what was applied', async () => {
  const applied = await app.evaluate(async () => {
    const ctx = (globalThis as any).__obsrv
    const clamped = ctx.target.setViewport(5000, 800)
    const restored = ctx.target.setViewport(1920, 1080)
    return { clamped, restored, current: ctx.target.getViewport() }
  })

  expect(applied.clamped).toEqual({ width: 4096, height: 800, clamped: true })
  expect(applied.restored).toEqual({ width: 1920, height: 1080, clamped: false })
  expect(applied.current).toEqual({ width: 1920, height: 1080 })
})

test('reports loading start and stop', async () => {
  const states: boolean[] = await app.evaluate(async (_electron, url: string) => {
    const ctx = (globalThis as any).__obsrv
    const seen: boolean[] = []
    const onLoading = (v: boolean) => seen.push(v)
    ctx.target.on('loading', onLoading)
    await ctx.target.load(url)
    // `load()` resolves on did-finish-load; did-stop-loading follows it.
    if (seen.at(-1) !== false) await new Promise(res => ctx.target.once('loading', res))
    ctx.target.off('loading', onLoading)
    return seen
  }, FIXTURE)

  expect(states[0]).toBe(true)
  expect(states.at(-1)).toBe(false)
})

test('reports navigation', async () => {
  const url = await app.evaluate(async (_electron, u: string) => {
    const ctx = (globalThis as any).__obsrv
    const navigated = new Promise<string>(res => ctx.target.once('url-changed', res))
    void ctx.target.load(u)
    return navigated
  }, FIXTURE)

  expect(url).toBe(FIXTURE)
})

test('forwards clicks into the offscreen page', async () => {
  const title = await app.evaluate(async () => {
    const ctx = (globalThis as any).__obsrv
    ctx.target.setViewport(400, 200)
    const html =
      '<body style="margin:0">' +
      '<button style="width:400px;height:200px;background:#00ff00;border:0" onclick="document.title=\'clicked\'">x</button>'
    // `load()` resolves on did-finish-load, which can precede the page's
    // first paint; a click dispatched before then has nothing to hit. Wait
    // for a frame that shows the green button (sampled away from its label)
    // — the previous page repainted at 400x200 is not green, so no false match.
    const painted = (globalThis as any).__waitForFrame(
      ctx.target,
      (m: any) => {
        const f = m.frame
        const px = 40 - f.x
        const py = 40 - f.y
        if (px < 0 || py < 0 || px >= f.width || py >= f.height) return false
        const i = (py * f.width + px) * 4
        return f.data[i] === 0 && f.data[i + 1] === 255 && f.data[i + 2] === 0
      },
      'green button',
    )
    await ctx.target.load('data:text/html,' + encodeURIComponent(html))
    if (!(await painted)) return 'no green button paint within 10s'

    const common = { button: 'left' as const, clickCount: 1, modifiers: [] as never[] }
    ctx.target.sendInput({ type: 'mouseDown', x: 200, y: 100, ...common })
    ctx.target.sendInput({ type: 'mouseUp', x: 200, y: 100, ...common })

    for (let i = 0; i < 40; i++) {
      if (ctx.target.webContents.getTitle() === 'clicked') return 'clicked'
      await new Promise(r => setTimeout(r, 50))
    }
    return ctx.target.webContents.getTitle()
  })

  expect(title).toBe('clicked')
})
