import { test, expect, type ElectronApplication } from '@playwright/test'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { launchApp } from './launch'

const FIXTURE = pathToFileURL(resolve(__dirname, '../fixtures/hairline.html')).href

let app: ElectronApplication

/**
 * Installs `globalThis.__waitForFrame(target, matches, label)` in main: it
 * resolves with the first `frame` event `matches` accepts and rejects loudly
 * after 10 s. Playwright serialises each `evaluate` callback's source, so a
 * helper defined in this file would not exist inside main — it is installed
 * once per app instead.
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
    return {
      hostScale,
      frameWidth: f.frameWidth,
      frameHeight: f.frameHeight,
      sliceBytes: f.frame.data.length,
      expectedBytes: f.frame.width * f.frame.height * 4,
    }
  }, FIXTURE)

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
    const d = f.frame.data
    return { x: f.frame.x, y: f.frame.y, b: d[0], g: d[1], r: d[2], a: d[3] }
  })

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
      '<button style="width:400px;height:200px" onclick="document.title=\'clicked\'">x</button>'
    await ctx.target.load('data:text/html,' + encodeURIComponent(html))

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
