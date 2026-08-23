import { test, expect, type ElectronApplication } from '@playwright/test'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { launchApp } from './launch'

const FIXTURE = pathToFileURL(resolve(__dirname, '../fixtures/hairline.html')).href

let app: ElectronApplication

test.beforeAll(async () => {
  // Force a 2x host so the 1x assertion below discriminates on any machine:
  // on a 1x host (or a Retina Mac in clamshell on 1x externals) it would pass
  // trivially. Chromium applies this to every surface except an offscreen
  // one with an explicit `deviceScaleFactor`, which is exactly the claim.
  app = await launchApp(['--force-device-scale-factor=2'])
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
    // Let the resize repaint drain so the frame we grab is at the new size.
    await new Promise(r => setTimeout(r, 750))
    const framePromise = new Promise<any>((res, rej) => {
      const timer = setTimeout(() => rej(new Error('no paint within 10s')), 10_000)
      ctx.target.once('frame', (f: any) => {
        clearTimeout(timer)
        res(f)
      })
    })
    ctx.target.invalidate()
    const f = await framePromise
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
    ctx.target.setViewport(200, 100)
    const html = '<body style="margin:0;background:#ff0000">'
    await ctx.target.load('data:text/html,' + encodeURIComponent(html))
    await new Promise(r => setTimeout(r, 750))
    const framePromise = new Promise<any>((res, rej) => {
      const timer = setTimeout(() => rej(new Error('no paint within 10s')), 10_000)
      ctx.target.once('frame', (f: any) => {
        clearTimeout(timer)
        res(f)
      })
    })
    ctx.target.invalidate()
    const f = await framePromise
    const d = f.frame.data
    return { x: f.frame.x, y: f.frame.y, b: d[0], g: d[1], r: d[2], a: d[3] }
  })

  expect(px).toEqual({ x: 0, y: 0, b: 0, g: 0, r: 255, a: 255 })
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
    await new Promise(r => setTimeout(r, 250))
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
