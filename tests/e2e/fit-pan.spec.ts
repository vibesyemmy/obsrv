import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { computeFitScale, jumpScroll } from '../../src/renderer/src/view/viewMath'
import { launchApp, rendererWindow } from './launch'

const TALL = pathToFileURL(resolve(__dirname, '../fixtures/tall.html')).href
const BUTTON = pathToFileURL(resolve(__dirname, '../fixtures/button.html')).href

/** The default preset's viewport (1080p 24"). */
const VP = { width: 1920, height: 1080 }

let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  app = await launchApp()
  page = await rendererWindow(app)
})
test.afterAll(async () => {
  await app.close()
})

/** Runs `code` inside the target page itself, for reading its own state. */
const inTarget = (code: string) =>
  app.evaluate(
    (_electron, c) => (globalThis as any).__obsrv.target.webContents.executeJavaScript(c),
    code,
  )

const load = async (url: string): Promise<void> => {
  await page.fill('.url-form input', url)
  await page.press('.url-form input', 'Enter')
  await expect.poll(() => inTarget('location.href')).toBe(url)
}

/** Clicks the segmented control into the named view, whatever is active now. */
const setView = async (which: '1:1' | 'fit'): Promise<void> => {
  const button = page.locator(which === 'fit' ? '.view-fit' : '.view-1x')
  if ((await button.getAttribute('aria-pressed')) !== 'true') await button.click()
  await expect(button).toHaveAttribute('aria-pressed', 'true')
}

const paneScroll = () =>
  page.evaluate(() => {
    const b = document.querySelector('.target-pane .pane-body') as HTMLElement
    return { left: b.scrollLeft, top: b.scrollTop }
  })

const resetScroll = () =>
  page.evaluate(() => {
    const b = document.querySelector('.target-pane .pane-body') as HTMLElement
    b.scrollLeft = 0
    b.scrollTop = 0
  })

/**
 * The pane's client box (what TargetCanvas's ResizeObserver measures), the
 * canvas's CSS box and backing store, and the window's dpr — everything the
 * fit maths runs on, read in one evaluate so nothing moves between reads.
 */
const boxes = () =>
  page.evaluate(() => {
    const body = document.querySelector('.target-pane .pane-body') as HTMLElement
    const canvas = document.querySelector('.target-pane canvas') as HTMLCanvasElement
    const c = canvas.getBoundingClientRect()
    return {
      pane: { width: body.clientWidth, height: body.clientHeight },
      canvas: { x: c.left, y: c.top, width: c.width, height: c.height },
      backing: { width: canvas.width, height: canvas.height },
      dpr: window.devicePixelRatio,
    }
  })

test('fit draws the whole viewport inside the pane and the footer says so', async () => {
  await load(TALL)
  await setView('1:1')
  const before = await boxes()
  // The premise: at 1:1 the 1920×1080 preset overflows the pane.
  expect(before.canvas.width).toBeGreaterThan(before.pane.width)

  await setView('fit')
  await expect
    .poll(async () => {
      const b = await boxes()
      return b.canvas.width <= b.pane.width && b.canvas.height <= b.pane.height
    })
    .toBe(true)
  const footer = page.locator('.target-pane .pane-footer')
  await expect(footer).toContainText('fit ×')
  await expect(footer).toContainText('not pixel-exact')

  await setView('1:1')
  await expect(footer).not.toContainText('fit ×')
})

test('a click in fit jumps to 1:1 with the clicked target pixel centred', async () => {
  await load(TALL)
  await setView('1:1')
  const at1x = await boxes()
  // The exact 1:1 magnification, recovered the way TargetCanvas's CSS box is
  // built from it: backing = round(viewport × S).
  const oneToOne = at1x.backing.width / VP.width

  await setView('fit')
  // The pane's scroll clamps to 0 the moment the content fits, so the canvas
  // sits at the pane origin and its box is the click's frame of reference.
  const b = await boxes()
  const px = Math.round(b.canvas.x + b.canvas.width * 0.7)
  const py = Math.round(b.canvas.y + b.canvas.height * 0.65)
  const clickX = px - b.canvas.x
  const clickY = py - b.canvas.y
  const fs = computeFitScale(b.pane.width, b.pane.height, b.dpr, VP.width, VP.height, oneToOne)
  const expected = jumpScroll(
    clickX,
    clickY,
    b.dpr,
    fs,
    oneToOne,
    b.pane.width,
    b.pane.height,
    VP.width,
    VP.height,
  )

  await page.mouse.click(px, py)
  await expect(page.locator('.view-1x')).toHaveAttribute('aria-pressed', 'true')
  await expect
    .poll(async () => Math.abs((await paneScroll()).left - expected.left))
    .toBeLessThanOrEqual(2)
  await expect
    .poll(async () => Math.abs((await paneScroll()).top - expected.top))
    .toBeLessThanOrEqual(2)
})

test('in fit, the wheel still browses the page', async () => {
  await load(TALL)
  await setView('fit')
  await inTarget('scrollTo(0, 0)')
  await expect.poll(() => inTarget('scrollY')).toBe(0)

  const b = await boxes()
  await page.mouse.move(b.canvas.x + b.canvas.width / 2, b.canvas.y + b.canvas.height / 2)
  await page.mouse.wheel(0, 400)
  await expect.poll(() => inTarget('scrollY')).toBeGreaterThan(0)
})

test('in fit, a click switches views without reaching the page', async () => {
  await load(BUTTON)
  await expect.poll(() => inTarget('document.title')).toBe('ready')
  await setView('fit')

  const b = await boxes()
  await page.mouse.click(b.canvas.x + b.canvas.width / 2, b.canvas.y + b.canvas.height / 2)
  // The click's only effect is the view switch…
  await expect(page.locator('.view-1x')).toHaveAttribute('aria-pressed', 'true')
  // …never the viewport-sized button under it. Negative case: give a
  // forwarded click time to land before reading the title.
  await page.waitForTimeout(300)
  expect(await inTarget('document.title')).toBe('ready')
})

test('in 1:1, Alt+wheel pans the pane and leaves the page alone', async () => {
  await load(TALL)
  await setView('1:1')
  await resetScroll()
  await inTarget('scrollTo(0, 0)')
  await expect.poll(() => inTarget('scrollY')).toBe(0)

  const b = await boxes()
  await page.mouse.move(b.canvas.x + b.pane.width / 2, b.canvas.y + b.pane.height / 2)
  await page.keyboard.down('Alt')
  await page.mouse.wheel(120, 80)
  await page.keyboard.up('Alt')

  // Natural direction: positive deltas move right and down.
  await expect.poll(async () => (await paneScroll()).left).toBeGreaterThan(100)
  await expect.poll(async () => (await paneScroll()).top).toBeGreaterThan(60)
  // Negative case: a forwarded wheel would have scrolled the page by now.
  await page.waitForTimeout(300)
  expect(await inTarget('scrollY')).toBe(0)
})

test('in 1:1, a middle-button drag pans', async () => {
  await load(TALL)
  await setView('1:1')
  await resetScroll()
  await inTarget('scrollTo(0, 0)')

  const b = await boxes()
  const cx = b.canvas.x + b.pane.width / 2
  const cy = b.canvas.y + b.pane.height / 2
  await page.mouse.move(cx, cy)
  await page.mouse.down({ button: 'middle' })
  // The content follows the pointer: dragging up-left reveals down-right.
  await page.mouse.move(cx - 150, cy - 90, { steps: 6 })
  await page.mouse.up({ button: 'middle' })

  await expect.poll(async () => (await paneScroll()).left).toBeGreaterThan(120)
  await expect.poll(async () => (await paneScroll()).top).toBeGreaterThan(70)
  // The gesture never reached the page.
  await page.waitForTimeout(300)
  expect(await inTarget('scrollY')).toBe(0)
})
