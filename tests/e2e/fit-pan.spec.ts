import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { computeFitScale, jumpScroll } from '../../src/renderer/src/view/viewMath'
import { launchApp, rendererWindow } from './launch'

const TALL = pathToFileURL(resolve(__dirname, '../fixtures/tall.html')).href
const BUTTON = pathToFileURL(resolve(__dirname, '../fixtures/button.html')).href
const KEYS = pathToFileURL(resolve(__dirname, '../fixtures/keys.html')).href

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

/** How far the pane can scroll on each axis — the geometry-proof bound. */
const paneScrollRange = () =>
  page.evaluate(() => {
    const b = document.querySelector('.target-pane .pane-body') as HTMLElement
    return { left: b.scrollWidth - b.clientWidth, top: b.scrollHeight - b.clientHeight }
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

/**
 * boxes(), but only once fit's layout is self-consistent: the canvas box must
 * be the fit of the *current* pane box (canvas CSS width = round(viewport ×
 * fitScale) / dpr, exactly as TargetCanvas builds it). Entering fit can take
 * two layout passes when classic (space-taking) scrollbars are in play: the
 * first fit render sizes the canvas from the pane measured while 1:1's
 * scrollbars were up; the scrollbars then vanish, the pane widens, and a
 * ResizeObserver round-trip re-renders the canvas one frame later. A read
 * between those passes pairs the new pane with the old canvas and computes a
 * jump the app — consistent within either pass — never performs. macOS shows
 * classic scrollbars when no pointing device is attached (CI runners), so
 * that window never opens on a dev machine; on a loaded runner it is wide
 * enough to lose deterministically.
 */
const settledFitBoxes = async (oneToOne: number): Promise<Awaited<ReturnType<typeof boxes>>> => {
  let b = await boxes()
  await expect
    .poll(async () => {
      b = await boxes()
      const fs = computeFitScale(b.pane.width, b.pane.height, b.dpr, VP.width, VP.height, oneToOne)
      return Math.abs(b.canvas.width * b.dpr - Math.round(VP.width * fs))
    })
    .toBeLessThanOrEqual(1)
  return b
}

test('an Option+click in fit jumps to 1:1 with the clicked target pixel centred', async () => {
  await load(TALL)
  await setView('1:1')
  const at1x = await boxes()
  // The exact 1:1 magnification, recovered the way TargetCanvas's CSS box is
  // built from it: backing = round(viewport × S).
  const oneToOne = at1x.backing.width / VP.width

  await setView('fit')
  // The pane's scroll clamps to 0 the moment the content fits, so the canvas
  // sits at the pane origin and its box is the click's frame of reference —
  // once the canvas has caught up with the scrollbar-free pane (see
  // settledFitBoxes).
  const b = await settledFitBoxes(oneToOne)
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

  // Option, not a plain click: a plain click belongs to the page now.
  await page.keyboard.down('Alt')
  await page.mouse.click(px, py)
  await page.keyboard.up('Alt')
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

  // An Alt-modified wheel is a no-op in fit: it is the pan chord, fit has
  // nothing to pan, and it must not reach the page either. Checked first,
  // while nothing is in flight — a forwarded wheel animates the target's
  // scroll, and its late sync echo would poison a 'still zero' assertion.
  await page.keyboard.down('Alt')
  await page.mouse.wheel(0, 200)
  await page.keyboard.up('Alt')
  await page.waitForTimeout(300)
  expect(await inTarget('scrollY')).toBe(0)
  expect((await paneScroll()).top).toBe(0)

  // A plain wheel forwards and browses the page.
  await page.mouse.wheel(0, 400)
  await expect.poll(() => inTarget('scrollY')).toBeGreaterThan(0)
})

test('in fit, a plain click reaches the page and leaves the view alone', async () => {
  await load(BUTTON)
  await expect.poll(() => inTarget('document.title')).toBe('ready')
  await setView('fit')

  const b = await boxes()
  await page.mouse.click(b.canvas.x + b.canvas.width / 2, b.canvas.y + b.canvas.height / 2)
  // The viewport-sized button under the pointer is pressed: the click was
  // translated through fit's own magnification and forwarded to the page.
  await expect.poll(() => inTarget('document.title')).toBe('clicked')
  // And the view did not move: the jump is Option's job now.
  await expect(page.locator('.view-fit')).toHaveAttribute('aria-pressed', 'true')
})

test('in fit, the keyboard reaches the page too', async () => {
  await load(KEYS)
  await expect.poll(() => inTarget('document.title')).toBe('ready')
  await setView('fit')

  // The click both focuses the canvas in the shell and lands in the page, so
  // the keystroke that follows has somewhere to go.
  const b = await boxes()
  await page.mouse.click(b.canvas.x + b.canvas.width / 2, b.canvas.y + b.canvas.height / 2)
  await page.keyboard.press('k')
  await expect.poll(() => inTarget('document.title')).toBe('key:k')
})

test('in fit, an Option+click switches views without reaching the page', async () => {
  await load(BUTTON)
  await expect.poll(() => inTarget('document.title')).toBe('ready')
  await setView('fit')

  const b = await boxes()
  await page.keyboard.down('Alt')
  await page.mouse.click(b.canvas.x + b.canvas.width / 2, b.canvas.y + b.canvas.height / 2)
  await page.keyboard.up('Alt')
  // The Option+click's only effect is the view switch…
  await expect(page.locator('.view-1x')).toHaveAttribute('aria-pressed', 'true')
  // …never the viewport-sized button under it. Negative case: give a
  // forwarded click time to land before reading the title.
  await page.waitForTimeout(300)
  expect(await inTarget('document.title')).toBe('ready')
})

test('the cursor answers Option, not the view', async () => {
  await load(TALL)
  const cursor = () =>
    page.evaluate(() => getComputedStyle(document.querySelector('.target-pane canvas')!).cursor)

  // Fit rests as a plain pointer now — the pane is interactive, so the page's
  // own cursors show through — and offers the jump only while Option is down.
  await setView('fit')
  expect(await cursor()).not.toBe('zoom-in')
  await page.keyboard.down('Alt')
  await expect.poll(cursor).toBe('zoom-in')
  await page.keyboard.up('Alt')
  await expect.poll(cursor).not.toBe('zoom-in')

  // At 1:1 the same modifier offers the pan instead.
  await setView('1:1')
  expect(await cursor()).not.toBe('grab')
  await page.keyboard.down('Alt')
  await expect.poll(cursor).toBe('grab')
  await page.keyboard.up('Alt')
  await expect.poll(cursor).not.toBe('grab')
})

test('in 1:1, Alt+wheel pans the pane and leaves the page alone', async () => {
  await load(TALL)
  await setView('1:1')
  await resetScroll()
  await inTarget('scrollTo(0, 0)')
  await expect.poll(() => inTarget('scrollY')).toBe(0)

  // Hermetic on any window/display geometry: each axis pans by the wheel
  // delta or to the end of its scrollable range, whichever is nearer — an
  // axis with no range simply stays at 0.
  const range = await paneScrollRange()
  test.skip(range.left === 0 && range.top === 0, '1:1 canvas fits this pane — nothing to pan')

  const b = await boxes()
  await page.mouse.move(
    b.canvas.x + Math.min(b.canvas.width, b.pane.width) / 2,
    b.canvas.y + Math.min(b.canvas.height, b.pane.height) / 2,
  )
  await page.keyboard.down('Alt')
  await page.mouse.wheel(120, 80)
  await page.keyboard.up('Alt')

  // Natural direction: positive deltas move right and down.
  await expect
    .poll(async () => Math.abs((await paneScroll()).left - Math.min(120, range.left)))
    .toBeLessThanOrEqual(1.5)
  await expect
    .poll(async () => Math.abs((await paneScroll()).top - Math.min(80, range.top)))
    .toBeLessThanOrEqual(1.5)
  // Negative case: a forwarded wheel would have scrolled the page by now.
  await page.waitForTimeout(300)
  expect(await inTarget('scrollY')).toBe(0)
})

test('in 1:1, a middle-button drag pans', async () => {
  await load(TALL)
  await setView('1:1')
  await resetScroll()
  await inTarget('scrollTo(0, 0)')

  // Same geometry-proof bound as the Alt+wheel spec above.
  const range = await paneScrollRange()
  test.skip(range.left === 0 && range.top === 0, '1:1 canvas fits this pane — nothing to pan')

  const b = await boxes()
  const cx = Math.round(b.canvas.x + Math.min(b.canvas.width, b.pane.width) / 2)
  const cy = Math.round(b.canvas.y + Math.min(b.canvas.height, b.pane.height) / 2)
  await page.mouse.move(cx, cy)
  await page.mouse.down({ button: 'middle' })
  // The content follows the pointer: dragging up-left reveals down-right.
  await page.mouse.move(cx - 150, cy - 90, { steps: 6 })
  await page.mouse.up({ button: 'middle' })

  await expect
    .poll(async () => Math.abs((await paneScroll()).left - Math.min(150, range.left)))
    .toBeLessThanOrEqual(1.5)
  await expect
    .poll(async () => Math.abs((await paneScroll()).top - Math.min(90, range.top)))
    .toBeLessThanOrEqual(1.5)
  // The gesture never reached the page.
  await page.waitForTimeout(300)
  expect(await inTarget('scrollY')).toBe(0)
})
