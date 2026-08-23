import { test, expect, type ElectronApplication } from '@playwright/test'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { launchApp } from './launch'

const THIN = pathToFileURL(resolve(__dirname, '../fixtures/thin-text.html')).href
const TALL = pathToFileURL(resolve(__dirname, '../fixtures/tall.html')).href

let app: ElectronApplication

test.beforeAll(async () => {
  // The dev Mac may have no Retina display attached (see target-source.spec):
  // force a 2x host so the native pane really does raster at 2x and the
  // comparison below discriminates regardless of what is plugged in.
  app = await launchApp(['--force-device-scale-factor=2'])
  await new Promise(r => setTimeout(r, 1500))
})
test.afterAll(async () => {
  await app.close()
})

test('the target really rasterises at 1x: half the rows of ink', async () => {
  const seen = await app.evaluate(async ({ screen }, url: string) => {
    const ctx = (globalThis as any).__obsrv

    // Same CSS box in both panes, so the two rasters lay the text out
    // identically and only the device resolution differs.
    ctx.native.setBounds({ x: 0, y: 0, width: 600, height: 400 })
    ctx.target.setViewport(600, 400)
    ctx.sync.expect(url)
    await Promise.all([ctx.native.load(url), ctx.target.load(url)])
    await new Promise(r => setTimeout(r, 1500))

    // A full-frame paint of the settled page, bounded: a dirty-rect slice
    // still in flight from the load would be scanned as if it were the page.
    const framePromise = new Promise<any>((res, rej) => {
      const timer = setTimeout(() => {
        ctx.target.off('frame', onFrame)
        rej(new Error('no full 600x400 paint within 10s'))
      }, 10_000)
      const onFrame = (f: any): void => {
        const full = f.frame.x === 0 && f.frame.y === 0 && f.frame.width === 600 && f.frame.height === 400
        if (!(full && f.frameWidth === 600 && f.frameHeight === 400)) return
        clearTimeout(timer)
        ctx.target.off('frame', onFrame)
        res(f)
      }
      ctx.target.on('frame', onFrame)
    })
    ctx.target.invalidate()
    const frame = await framePromise

    const shot = await ctx.native.webContents.capturePage()
    const sf = screen.getDisplayMatching(ctx.win.getBounds()).scaleFactor
    const size = shot.getSize()
    const bitmap = new Uint8Array(shot.toBitmap())
    // `getSize()` is not reliably DIP: under a forced scale factor the capture
    // comes back as a bare 1200x800 bitmap with no scale information, so the
    // device size is read off the bitmap's own byte count instead.
    const k = Math.sqrt(bitmap.length / (size.width * size.height * 4))
    const nativeW = Math.round(size.width * k)
    const nativeH = Math.round(size.height * k)

    /** Rows containing at least one pixel darker than `INK`, from BGRA bytes. */
    const inkRows = (bgra: Uint8Array, width: number, height: number): number => {
      const INK = 200
      let rows = 0
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4
          const lum = 0.2126 * bgra[i + 2]! + 0.7152 * bgra[i + 1]! + 0.0722 * bgra[i]!
          if (lum < INK) {
            rows++
            break
          }
        }
      }
      return rows
    }

    return {
      sf,
      nativeW,
      nativeH,
      nativeBytes: bitmap.length,
      native: inkRows(bitmap, nativeW, nativeH),
      target: inkRows(frame.frame.data, frame.frameWidth, frame.frameHeight),
      targetWidth: frame.frameWidth,
      targetHeight: frame.frameHeight,
    }
  }, THIN)

  // The 1x frame is the CSS box, not the device box.
  expect(seen.targetWidth).toBe(600)
  expect(seen.targetHeight).toBe(400)
  expect(seen.target).toBeGreaterThan(3)

  // On a 1x host both panes are the same raster and there is nothing to compare.
  test.skip(seen.sf < 2, 'needs a HiDPI host — the whole premise of the product')

  // The native capture is the same CSS box at device resolution, and the
  // stride used below is exactly its width — or the row count means nothing.
  expect(seen.nativeW).toBe(600 * seen.sf)
  expect(seen.nativeH).toBe(400 * seen.sf)
  expect(seen.nativeBytes).toBe(seen.nativeW * seen.nativeH * 4)

  // The same glyphs get `sf` times as many device rows on the native pane.
  // If the target were secretly rendering at the host scale, these would match.
  expect(seen.native).toBeGreaterThan(seen.target * 1.5)
})

test('a scroll reaches the other pane within 100 ms', async () => {
  const elapsed = await app.evaluate(async (_electron, url: string) => {
    const ctx = (globalThis as any).__obsrv
    ctx.sync.expect(url)
    await Promise.all([ctx.native.load(url), ctx.target.load(url)])
    await new Promise(r => setTimeout(r, 1200))

    // The target page stamps the wall clock itself, so the measurement does
    // not include any polling round trips.
    await ctx.target.webContents.executeJavaScript(
      "window.__arrived = 0; addEventListener('scroll', () => { window.__arrived = Date.now() }, { once: true })",
    )

    const sent = Date.now()
    await ctx.native.webContents.executeJavaScript('window.scrollTo(0, 1500)')
    await new Promise(r => setTimeout(r, 1000))

    const arrived: number = await ctx.target.webContents.executeJavaScript('window.__arrived')
    const y: number = await ctx.target.webContents.executeJavaScript('window.scrollY')
    return { ms: arrived === 0 ? -1 : arrived - sent, y }
  }, TALL)

  expect(elapsed.y).toBe(1500)
  expect(elapsed.ms).toBeGreaterThanOrEqual(0)
  expect(elapsed.ms).toBeLessThan(100)
})
