import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { launchApp, rendererWindow } from './launch'

// The last test detaches the bus for good, so order matters.
test.describe.configure({ mode: 'serial' })

let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  app = await launchApp()
  page = await rendererWindow(app)
})
test.afterAll(async () => {
  await app.close()
})

/** Installs a collector on window.obsrv.onFrame, replacing any previous one. */
async function collect(p: Page): Promise<void> {
  await p.evaluate(() => {
    const w = window as any
    if (w.__off) w.__off()
    w.__frames = []
    w.__off = window.obsrv.onFrame((m: any) => {
      w.__frames.push({
        x: m.frame.x,
        y: m.frame.y,
        width: m.frame.width,
        height: m.frame.height,
        bytes: m.frame.data.length,
        first4: Array.from(m.frame.data.slice(0, 4)),
        frameWidth: m.frameWidth,
        frameHeight: m.frameHeight,
      })
    })
  })
}

test('frames reach the renderer with intact BGRA bytes', async () => {
  await collect(page)

  await app.evaluate(async () => {
    const ctx = (globalThis as any).__obsrv
    ctx.target.setViewport(200, 100)
    const html = '<body style="margin:0;background:#0000ff">'
    await ctx.target.load('data:text/html,' + encodeURIComponent(html))
  })

  // Stale-size paints of the previous page can trail a viewport change, so
  // wait for a full frame at the applied size that is not the white
  // about:blank (green channel is 0 in either byte order).
  const last = await page.waitForFunction(() =>
    (window as any).__frames.findLast(
      (f: any) => f.x === 0 && f.y === 0 && f.frameWidth === 200 && f.frameHeight === 100 && f.first4[1] === 0,
    ),
  ).then(h => h.jsonValue())

  expect(last.bytes).toBe(last.width * last.height * 4)
  // #0000ff in BGRA order.
  expect(last.first4).toEqual([255, 0, 0, 255])
})

test('subscribing after the renderer has loaded still yields a frame (no manual invalidate)', async () => {
  await page.reload()
  // The page is fully loaded before anyone subscribes: under a
  // `did-finish-load → invalidate` design the only paint of this static
  // target would already have been sent and dropped by now.
  expect(await page.evaluate(() => document.readyState)).toBe('complete')

  await collect(page)

  await page.waitForFunction(() => (window as any).__frames.length > 0)
})

test('detach stops delivery', async () => {
  // Detach before subscribing: a fresh subscription would otherwise open the
  // gate and collect its own handshake frame. After detach, neither the
  // handshake nor a manual invalidate may deliver anything.
  await app.evaluate(() => (globalThis as any).__obsrv.bus.detach())
  await collect(page)

  await app.evaluate(async () => {
    const ctx = (globalThis as any).__obsrv
    ctx.target.invalidate()
    await new Promise(r => setTimeout(r, 500))
  })

  const frames: any[] = await page.evaluate(() => (window as any).__frames)
  expect(frames).toEqual([])
})
