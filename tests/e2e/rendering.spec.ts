import { test, expect, type ElectronApplication } from '@playwright/test'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { launchApp } from './launch'

const THIN = pathToFileURL(resolve(__dirname, '../fixtures/thin-text.html')).href
const HAIRLINE = pathToFileURL(resolve(__dirname, '../fixtures/hairline.html')).href
const TALL = pathToFileURL(resolve(__dirname, '../fixtures/tall.html')).href

let app: ElectronApplication

test.beforeAll(async () => {
  // The dev Mac may have no Retina display attached (see target-source.spec):
  // force a 2x host so the native pane really does raster at 2x and the
  // comparisons below discriminate regardless of what is plugged in.
  app = await launchApp(['--force-device-scale-factor=2'])
})
test.afterAll(async () => {
  await app.close()
})

/**
 * Loads `url` into both panes at a 600x400 CSS box and installs
 * `globalThis.__captured(): { sf, frame, bitmap, nativeW, nativeH }` holding a
 * full 600x400 1x frame of the target and the native pane's device-resolution
 * capture. Serialised into main once per test (Playwright ships each
 * `evaluate` callback's source on its own, so tests cannot share a closure).
 *
 * No fixed sleeps: `load()` resolves on `did-finish-load`, the frame is a
 * bounded wait for a *full* 600x400 slice (a dirty-rect slice still in flight
 * from the load must not be scanned as if it were the page), and the capture
 * is polled until it contains ink — the first composite can lag
 * `did-finish-load` by a frame or two.
 */
const captureBoth = async (ctx: any, screen: any, url: string) => {
  ctx.native.setBounds({ x: 0, y: 0, width: 600, height: 400 })
  ctx.target.setViewport(600, 400)
  ctx.sync.expect(url)
  await Promise.all([ctx.native.load(url), ctx.target.load(url)])

  const framePromise = new Promise<any>(res => {
    // Resolves null on timeout rather than rejecting: a rejection that lands
    // after its test has already timed out is reported by Playwright as an
    // error outside any test, and fails the run even when every test passed.
    const timer = setTimeout(() => {
      ctx.target.off('frame', onFrame)
      res(null)
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
  if (!frame) return null

  const lum = (b: Uint8Array, i: number): number => 0.2126 * b[i + 2]! + 0.7152 * b[i + 1]! + 0.0722 * b[i]!
  let bitmap = new Uint8Array(0)
  let nativeW = 0
  let nativeH = 0
  for (let tries = 0; tries < 100; tries++) {
    const shot = await ctx.native.webContents.capturePage()
    const size = shot.getSize()
    const b = new Uint8Array(shot.toBitmap())
    // `getSize()` is not reliably DIP: under a forced scale factor the capture
    // comes back as a bare 1200x800 bitmap with no scale information, so the
    // device size is read off the bitmap's own byte count instead.
    const k = Math.sqrt(b.length / (size.width * size.height * 4))
    nativeW = Math.round(size.width * k)
    nativeH = Math.round(size.height * k)
    let hasInk = false
    for (let i = 0; i < b.length && !hasInk; i += 4) hasInk = lum(b, i) < 200
    if (hasInk) {
      bitmap = b
      break
    }
    await new Promise(r => setTimeout(r, 100))
  }
  if (bitmap.length === 0) throw new Error('native capture never painted any ink within 10s')

  const sf = screen.getDisplayMatching(ctx.win.getBounds()).scaleFactor
  return { sf, frame, bitmap, nativeW, nativeH, lum }
}

test('the target really rasterises at 1x: half the rows of ink, darker glyphs', async () => {
  const seen = await app.evaluate(async ({ screen }, arg: { url: string; capture: string }) => {
    const ctx = (globalThis as any).__obsrv
    // eslint-disable-next-line no-eval
    const captured = await (0, eval)(arg.capture)(ctx, screen, arg.url)
    if (!captured) return null
    const { sf, frame, bitmap, nativeW, nativeH, lum } = captured

    /** Rows containing at least one pixel darker than `INK`, from BGRA bytes. */
    const inkRows = (bgra: Uint8Array, width: number, height: number): number => {
      const INK = 200
      let rows = 0
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (lum(bgra, (y * width + x) * 4) < INK) {
            rows++
            break
          }
        }
      }
      return rows
    }

    // Spec §2: the thin text must *visibly* differ, not merely occupy fewer
    // rows. Mean ink (255 - luminance) over the glyphs' bounding box, in the
    // 1x raster and in the native capture box-filtered down to the same grid:
    // if 1x rendering were just a resample of the 2x rendering, these would
    // be equal by construction.
    const t: Uint8Array = frame.frame.data
    let x0 = 600, x1 = -1, y0 = 400, y1 = -1
    for (let y = 0; y < 400; y++) {
      for (let x = 0; x < 600; x++) {
        if (lum(t, (y * 600 + x) * 4) < 230) {
          if (x < x0) x0 = x
          if (x > x1) x1 = x
          if (y < y0) y0 = y
          if (y > y1) y1 = y
        }
      }
    }
    let sum1x = 0
    let sumNative = 0
    let n = 0
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        sum1x += 255 - lum(t, (y * 600 + x) * 4)
        let acc = 0
        let cells = 0
        for (let dy = 0; dy < sf; dy++) {
          for (let dx = 0; dx < sf; dx++) {
            acc += lum(bitmap, ((y * sf + dy) * nativeW + x * sf + dx) * 4)
            cells++
          }
        }
        sumNative += 255 - acc / cells
        n++
      }
    }

    return {
      sf,
      nativeW,
      nativeH,
      nativeBytes: bitmap.length,
      native: inkRows(bitmap, nativeW, nativeH),
      target: inkRows(t, frame.frameWidth, frame.frameHeight),
      targetWidth: frame.frameWidth,
      targetHeight: frame.frameHeight,
      bbox: [x0, y0, x1, y1],
      mean1x: sum1x / n,
      meanNative: sumNative / n,
    }
  }, { url: THIN, capture: `(${captureBoth.toString()})` })

  // The 1x frame is the CSS box, not the device box.
  if (!seen) throw new Error('no full 600x400 paint within 10s')
  expect(seen.targetWidth).toBe(600)
  expect(seen.targetHeight).toBe(400)
  expect(seen.target).toBeGreaterThan(3)

  // On a 1x host both panes are the same raster and there is nothing to compare.
  test.skip(seen.sf < 2, 'needs a HiDPI host — the whole premise of the product')

  // The native capture is the same CSS box at device resolution, and the
  // stride used above is exactly its width — or the row count means nothing.
  expect(seen.nativeW).toBe(600 * seen.sf)
  expect(seen.nativeH).toBe(400 * seen.sf)
  expect(seen.nativeBytes).toBe(seen.nativeW * seen.nativeH * 4)

  // The same glyphs get `sf` times as many device rows on the native pane.
  // If the target were secretly rendering at the host scale, these would match.
  expect(seen.native).toBeGreaterThan(seen.target * 1.5)

  // And the 1x glyphs are not a resample of the 2x glyphs: the rasteriser
  // makes different anti-aliasing decisions at 1x (observed ~29.3 vs ~26.9
  // mean ink on this stack), which is what "visibly differ" means in numbers.
  expect(Math.abs(seen.mean1x - seen.meanNative)).toBeGreaterThan(1)
})

test('a 0.5px hairline does not scale with the raster: one device row in both panes', async () => {
  const seen = await app.evaluate(async ({ screen }, arg: { url: string; capture: string }) => {
    const ctx = (globalThis as any).__obsrv
    // eslint-disable-next-line no-eval
    const captured = await (0, eval)(arg.capture)(ctx, screen, arg.url)
    if (!captured) return null
    const { sf, frame, bitmap, nativeW, nativeH, lum } = captured

    // A hairline is the only thing in the fixture spanning (nearly) the full
    // width; text never reaches 80% of a row and the gradient ramp's dark
    // half stays under 50%.
    const hairlineRows = (bgra: Uint8Array, width: number, height: number): number[] => {
      const rows: number[] = []
      for (let y = 0; y < height; y++) {
        let dark = 0
        for (let x = 0; x < width; x++) {
          if (lum(bgra, (y * width + x) * 4) < 128) dark++
        }
        if (dark > width * 0.8) rows.push(y)
      }
      return rows
    }
    const inkRows = (bgra: Uint8Array, width: number, height: number): number => {
      let rows = 0
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (lum(bgra, (y * width + x) * 4) < 200) {
            rows++
            break
          }
        }
      }
      return rows
    }

    return {
      sf,
      nativeHairlines: hairlineRows(bitmap, nativeW, nativeH),
      targetHairlines: hairlineRows(frame.frame.data, 600, 400),
      nativeInk: inkRows(bitmap, nativeW, nativeH),
      targetInk: inkRows(frame.frame.data, 600, 400),
    }
  }, { url: HAIRLINE, capture: `(${captureBoth.toString()})` })

  test.skip(seen.sf < 2, 'needs a HiDPI host — the whole premise of the product')

  // Chromium snaps a 0.5px border to one device row at either scale, so each
  // of the fixture's two hairlines is exactly one row of ink in both rasters…
  if (!seen) throw new Error('no full 600x400 paint within 10s')
  expect(seen.targetHairlines).toHaveLength(2)
  expect(seen.nativeHairlines).toHaveLength(2)

  // …at the same place in the layout…
  expect(Math.abs(seen.nativeHairlines[0]! - seen.targetHairlines[0]! * seen.sf)).toBeLessThanOrEqual(1)
  expect(Math.abs(seen.nativeHairlines[1]! - seen.targetHairlines[1]! * seen.sf)).toBeLessThanOrEqual(1)

  // …which is why the panes visibly differ (spec §2, §10): the text's row
  // count scales with the raster, the hairline's does not — relative to the
  // page, a hairline at 1x is `sf` times as thick as the native render.
  expect(seen.nativeInk).toBeGreaterThan(seen.targetInk * 1.5)
  expect(seen.nativeHairlines.length).toBeLessThan(seen.targetHairlines.length * seen.sf)
})

test('a scroll reaches the other pane within 100 ms', async () => {
  const elapsed = await app.evaluate(async (_electron, url: string) => {
    const ctx = (globalThis as any).__obsrv
    ctx.sync.expect(url)
    // `load()` resolves on `did-finish-load`; the sync preload attached at
    // document start, so both reporters are live from here.
    await Promise.all([ctx.native.load(url), ctx.target.load(url)])

    // The target page stamps the wall clock itself, so the measurement does
    // not include the polling round trips below.
    await ctx.target.webContents.executeJavaScript(
      "window.__arrived = 0; addEventListener('scroll', () => { window.__arrived = Date.now() }, { once: true })",
    )

    const sent = Date.now()
    await ctx.native.webContents.executeJavaScript('window.scrollTo(0, 1500)')
    let arrived = 0
    const deadline = Date.now() + 5000
    while (arrived === 0 && Date.now() < deadline) {
      arrived = await ctx.target.webContents.executeJavaScript('window.__arrived')
      if (arrived === 0) await new Promise(r => setTimeout(r, 50))
    }

    const y: number = await ctx.target.webContents.executeJavaScript('window.scrollY')
    return { ms: arrived === 0 ? -1 : arrived - sent, y }
  }, TALL)

  expect(elapsed.y).toBe(1500)
  expect(elapsed.ms).toBeGreaterThanOrEqual(0)
  expect(elapsed.ms).toBeLessThan(100)
})
