import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { launchApp, rendererWindow } from './launch'

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
    await new Promise(r => setTimeout(r, 500))
    ctx.target.invalidate()
    await new Promise(r => setTimeout(r, 500))
  })

  const frames: any[] = await page.evaluate(() => (window as any).__frames)
  expect(frames.length).toBeGreaterThan(0)

  const last = frames[frames.length - 1]
  expect({ x: last.x, y: last.y }).toEqual({ x: 0, y: 0 })
  expect(last.frameWidth).toBe(200)
  expect(last.frameHeight).toBe(100)
  expect(last.bytes).toBe(last.width * last.height * 4)
  // #0000ff in BGRA order.
  expect(last.first4).toEqual([255, 0, 0, 255])
})

test('delivery resumes after the renderer reloads', async () => {
  await page.reload()
  await collect(page)

  await app.evaluate(async () => {
    const ctx = (globalThis as any).__obsrv
    ctx.target.invalidate()
    await new Promise(r => setTimeout(r, 500))
  })

  const frames: any[] = await page.evaluate(() => (window as any).__frames)
  expect(frames.length).toBeGreaterThan(0)
})

test('detach stops delivery', async () => {
  await collect(page)

  await app.evaluate(async () => {
    const ctx = (globalThis as any).__obsrv
    ctx.bus.detach()
    ctx.target.invalidate()
    await new Promise(r => setTimeout(r, 500))
  })

  const frames: any[] = await page.evaluate(() => (window as any).__frames)
  expect(frames).toEqual([])
})
