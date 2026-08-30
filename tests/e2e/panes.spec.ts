import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { launchApp, openOverflow, rendererWindow } from './launch'
import { choose } from './helpers/select'

const FIXTURE = pathToFileURL(resolve(__dirname, '../fixtures/hairline.html')).href

let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  app = await launchApp()
  page = await rendererWindow(app)
})
test.afterAll(async () => {
  await app.close()
})

const canvasSize = (p: Page) =>
  p.evaluate(() => {
    const c = document.querySelector('.target-pane canvas') as HTMLCanvasElement
    const r = c.getBoundingClientRect()
    return {
      backingW: c.width,
      backingH: c.height,
      cssW: Math.round(r.width),
      dpr: window.devicePixelRatio,
    }
  })

const paneUrls = () =>
  app.evaluate(() => {
    const ctx = (globalThis as any).__obsrv
    return { native: ctx.native.webContents.getURL(), target: ctx.target.webContents.getURL() }
  })

/**
 * Greyscale statistics of the visible part of the target canvas, read back
 * from a compositor screenshot. WebGL's drawing buffer is cleared after each
 * composite (no `preserveDrawingBuffer`), so `readPixels` from a later task
 * would see black; the screenshot sees what the user sees.
 */
async function canvasPixels(): Promise<{ distinct: number; white: number; total: number }> {
  const clip = await page.evaluate(() => {
    const c = document.querySelector('.target-pane canvas')!
    const r = c.getBoundingClientRect()
    const body = c.closest('.pane-body')!.getBoundingClientRect()
    // The canvas can overflow its pane; only the visible part is on screen.
    const left = Math.max(r.left, body.left)
    const top = Math.max(r.top, body.top)
    const right = Math.min(r.right, body.right)
    const bottom = Math.min(r.bottom, body.bottom)
    return { x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) }
  })
  const png = await page.screenshot({ clip })
  return page.evaluate(async (b64: string) => {
    const img = new Image()
    img.src = 'data:image/png;base64,' + b64
    await img.decode()
    const c = document.createElement('canvas')
    c.width = img.naturalWidth
    c.height = img.naturalHeight
    const ctx = c.getContext('2d')!
    ctx.drawImage(img, 0, 0)
    const d = ctx.getImageData(0, 0, c.width, c.height).data
    const greys = new Set<number>()
    let white = 0
    for (let i = 0; i < d.length; i += 4) {
      greys.add(d[i]!)
      if (d[i]! >= 250) white++
    }
    return { distinct: greys.size, white, total: d.length / 4 }
  }, png.toString('base64'))
}

test('the toolbar navigates both panes', async () => {
  await page.fill('.url-form input', FIXTURE)
  await page.press('.url-form input', 'Enter')
  await expect.poll(paneUrls).toEqual({ native: FIXTURE, target: FIXTURE })
})

test('the target canvas shows the page, not a blank', async () => {
  // A canvas nothing has drawn into is black (alpha: false); the fixture is a
  // white page, so white pixels prove a frame was uploaded and drawn.
  await expect.poll(async () => (await canvasPixels()).white).toBeGreaterThan(1000)
  // Hairlines, grey text and a black-to-white ramp: not a flat fill.
  const px = await canvasPixels()
  expect(px.distinct).toBeGreaterThan(16)
  expect(px.white).toBeGreaterThan(px.total * 0.3)
})

test('main positions the native view exactly over the slot', async () => {
  const slot = await page.evaluate(() => {
    const r = document.querySelector('.native-slot')!.getBoundingClientRect()
    return {
      x: Math.round(r.left),
      y: Math.round(r.top),
      width: Math.round(r.width),
      height: Math.round(r.height),
    }
  })
  // The slot excludes the toolbar above and the footer below it.
  expect(slot.y).toBeGreaterThanOrEqual(44)
  expect(slot.width).toBeGreaterThan(100)
  await expect
    .poll(() => app.evaluate(() => (globalThis as any).__obsrv.native.getBounds()))
    .toEqual(slot)
})

test('the canvas is the target viewport magnified by S', async () => {
  // 1:1 explicitly: the app opens in fit, which clamps the drawn scale to the
  // pane, and the backing store below is asserted at true magnification.
  await page.click('.view-1x')
  await expect(page.locator('.view-1x')).toHaveAttribute('aria-pressed', 'true')
  // Pixel-exact pins S to the host scale factor, so the maths is checkable
  // without knowing the test machine's physical screen size.
  await openOverflow(page)
  await page.check('.overflow-menu .pixel-exact input')
  await page.keyboard.press('Escape')
  await choose(app, page, '.preset-select', 'laptop-768')

  const dpr = (await canvasSize(page)).dpr
  await expect
    .poll(() => canvasSize(page))
    .toEqual({
      backingW: Math.round(1366 * dpr),
      backingH: Math.round(768 * dpr),
      // One target pixel occupies exactly `dpr` device pixels: pixel-exact.
      cssW: 1366,
      dpr,
    })
})

test('switching preset resizes the target', async () => {
  await choose(app, page, '.preset-select', '1080p-27')

  const dpr = (await canvasSize(page)).dpr
  await expect
    .poll(() => canvasSize(page))
    .toEqual({
      backingW: Math.round(1920 * dpr),
      backingH: Math.round(1080 * dpr),
      cssW: 1920,
      dpr,
    })

  // The readout always states what the pane is showing.
  await expect(page.locator('.target-pane .pane-footer')).toContainText('1920×1080')
  await expect(page.locator('.target-pane .pane-footer')).toContainText('Reference')
})

test('a click on the canvas lands on the same target pixel', async () => {
  await app.evaluate(({}) =>
    (globalThis as any).__obsrv.target.webContents.executeJavaScript(
      `window.__hit = null;
       addEventListener('mousedown', e => { window.__hit = { x: e.clientX, y: e.clientY } });
       true`,
    ),
  )

  // The canvas is `viewport * S / DPR` CSS px wide, so one target pixel is
  // `rect.width / viewport.width` CSS px — whatever S and DPR happen to be.
  const rect = await page.evaluate(() => {
    const r = document.querySelector('.target-pane canvas')!.getBoundingClientRect()
    return { left: r.left, top: r.top, width: r.width }
  })
  const vp = await app.evaluate(() => (globalThis as any).__obsrv.target.getViewport())
  const mag = rect.width / vp.width
  const target = { x: 60, y: 40 }
  await page.mouse.click(rect.left + (target.x + 0.5) * mag, rect.top + (target.y + 0.5) * mag)

  await expect
    .poll(() =>
      app.evaluate(() => (globalThis as any).__obsrv.target.webContents.executeJavaScript('window.__hit')),
    )
    .toEqual(target)
})

test('a navigation elsewhere does not clobber a URL being typed', async () => {
  const TALL = pathToFileURL(resolve(__dirname, '../fixtures/tall.html')).href
  const input = page.locator('.url-form input')
  await input.fill('https://half-typed')
  await expect(input).toBeFocused()

  // A link click in the native pane, say: SyncBus mirrors it into the target
  // and reports the URL to the bar in the same handler, so once the target
  // has followed, the `onUrlChanged` has been sent.
  await app.evaluate(({}, u: string) => (globalThis as any).__obsrv.native.load(u), TALL)
  await expect.poll(paneUrls).toEqual({ native: TALL, target: TALL })
  await expect(input).toHaveValue('https://half-typed')

  // Escape discards the draft and shows where the panes actually are —
  // which also proves the URL change did reach the store.
  await input.press('Escape')
  await expect(input).toHaveValue(TALL)
})

test('a failed load leaves the error code showing in the toolbar', async () => {
  await page.fill('.url-form input', 'https://obsrv-no-such-host.invalid')
  await page.press('.url-form input', 'Enter')

  // The badge must survive the `did-navigate` to Chromium's own error page:
  // once both panes have stopped loading, every event of this navigation has
  // been delivered, and the badge must still be there.
  await expect(page.locator('.badge-error')).toBeVisible({ timeout: 15_000 })
  await expect
    .poll(() =>
      app.evaluate(() => {
        const ctx = (globalThis as any).__obsrv
        return ctx.native.webContents.isLoading() || ctx.target.webContents.isLoading()
      }),
    )
    .toBe(false)
  await expect(page.locator('.badge-error')).toBeVisible()
})

test('a later successful navigation clears the error badge', async () => {
  await page.fill('.url-form input', FIXTURE)
  await page.press('.url-form input', 'Enter')
  await expect(page.locator('.badge-error')).toHaveCount(0)
  await expect.poll(paneUrls).toEqual({ native: FIXTURE, target: FIXTURE })

  // And a history move, which does not go through the URL form at all.
  await app.evaluate(({}, u: string) => (globalThis as any).__obsrv.native.load('https://obsrv-no-such-host.invalid'), '')
  await expect(page.locator('.badge-error')).toBeVisible({ timeout: 15_000 })
  await page.click('.chrome-browse .icon-button[title="Back"]')
  await expect(page.locator('.badge-error')).toHaveCount(0)
  await expect.poll(paneUrls).toEqual({ native: FIXTURE, target: FIXTURE })
})
