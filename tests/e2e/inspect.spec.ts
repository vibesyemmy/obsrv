import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { choose } from './helpers/select'
import { launchApp, rendererWindow } from './launch'

/**
 * The inspector: hover the target and the footer reads the element, its
 * size in px and in mm on this screen, the colour pair, and the contrast as
 * stated and as this panel would show it. The second ratio is the one no
 * browser can produce; the rest is what makes it trustworthy.
 *
 * The fixture places four cases at known CSS coordinates: grey on the page
 * white, light text inside a dark card (the walk must find the card), white
 * on a half-black veil (the walk must composite it), and red over a gradient
 * (nothing stated is the colour under it, and the readout must say so).
 */

const FIXTURE = pathToFileURL(resolve(__dirname, '../fixtures/contrast.html')).href

let app: ElectronApplication
let page: Page
/** Where the grey caption is on the canvas, measured while the footer still states the magnification. */
let greyPoint: { x: number; y: number }

const inspect = (x: number, y: number): Promise<any> =>
  page.evaluate(([x, y]) => window.obsrv.inspect({ x, y }), [x, y] as const)

const footer = (): Promise<string> => page.locator('.target-pane .pane-footer').innerText()

/** Canvas coordinates of a CSS point of the target viewport, at the pane's current magnification. */
async function canvasPoint(cssX: number, cssY: number): Promise<{ x: number; y: number }> {
  const box = (await page.locator('.target-canvas').boundingBox())!
  // Canvas CSS px per target CSS px: the drawn magnification (host device
  // px per target device px) times the target's density, over the host's.
  const text = await footer()
  const fit = /fit ×([\d.]+)/.exec(text)
  const one = /×([\d.]+)/.exec(text)
  const scale = Number(fit?.[1] ?? one?.[1])
  const dsf: number = await app.evaluate(() => (globalThis as any).__obsrv.target.getDeviceScaleFactor())
  const dpr = await page.evaluate(() => window.devicePixelRatio)
  const k = (scale * dsf) / dpr
  return { x: box.x + cssX * k, y: box.y + cssY * k }
}

test.beforeAll(async () => {
  app = await launchApp()
  page = await rendererWindow(app)
  await page.fill('.url-form input', FIXTURE)
  await page.press('.url-form input', 'Enter')
  await expect.poll(() => page.evaluate(() => document.querySelector<HTMLCanvasElement>('canvas.target-canvas')?.dataset.gl)).toBe('ok')
  await expect.poll(() => inspect(20, 17).then(r => r?.id), { timeout: 10_000 }).toBe('grey')
})
test.afterAll(async () => {
  await app.close()
})

test('the page answers with the element, its font and its colour on the page white', async () => {
  const r = await inspect(20, 17)
  expect(r).toMatchObject({
    tag: 'p',
    id: 'grey',
    text: 'Grey caption text on white',
    fontSizePx: 13,
    fontWeight: 400,
    color: [107, 114, 128, 1],
    background: [255, 255, 255, 1],
    backgroundNote: 'computed',
  })
  expect(r.rect.width).toBeCloseTo(300, 0)
})

test('the walk finds a dark card behind text with no background of its own', async () => {
  const r = await inspect(40, 88)
  expect(r.id).toBe('card-text')
  expect(r.fontWeight).toBe(700)
  expect(r.background).toEqual([17, 17, 17, 1])
})

test('a translucent layer is composited onto what is under it', async () => {
  const r = await inspect(20, 166)
  expect(r.id).toBe('veil-text')
  expect(r.background.slice(0, 3).map(Math.round)).toEqual([128, 128, 128])
})

test('over a gradient the background is unknown, and said to be', async () => {
  const r = await inspect(20, 226)
  expect(r.id).toBe('photo-text')
  expect(r.background).toBeNull()
  expect(r.backgroundNote).toBe('image')
})

test('off the page, and for a bad point, the answer is null', async () => {
  expect(await inspect(5000, 5000)).toBeNull()
  expect(await page.evaluate(() => window.obsrv.inspect({ x: -1, y: 0 }))).toBeNull()
})

test('the footer reads the element under the pointer: size in mm, the pair, contrast here and on the panel', async () => {
  // The toggle lives in the target footer and must not change its height:
  // the two footers close the two panes, and they have to stay level.
  const heights = await page.evaluate(() =>
    [...document.querySelectorAll('.pane-footer')].map(f => f.getBoundingClientRect().height),
  )
  expect(heights).toHaveLength(2)
  expect(heights[0]).toBe(heights[1])

  const grey = await canvasPoint(20, 17)
  greyPoint = grey
  await page.click('.inspect-toggle')
  await expect(page.locator('.inspect-toggle')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.target-canvas')).toHaveClass(/inspecting/)
  await expect(page.locator('.target-pane .pane-footer .role')).toHaveText('INSPECT')

  await page.mouse.move(grey.x, grey.y)
  await expect.poll(footer, { timeout: 10_000 }).toContain('p#grey')
  const text = await footer()
  // 13px on a 24" 1080p is about 3.6 mm; the exact figure follows the preset.
  expect(text).toMatch(/13px = \d+\.\d mm/)
  expect(text).toContain('#6b7280 on #ffffff')
  expect(text).toContain('4.8:1 here')
  // The reference panel would only repeat the figure, so it is not quoted.
  expect(text).not.toContain(' on Reference')
  await expect(page.locator('.inspect-highlight')).toHaveCount(1)

  // A budget panel: the same pair, a lower ratio, named for the panel.
  await choose(app, page, '.profile-select', 'budget-tn')
  await page.mouse.move(grey.x + 1, grey.y)
  await expect.poll(footer, { timeout: 10_000 }).toContain('on Budget TN')
  const withPanel = await footer()
  const here = Number(/([\d.]+):1 here/.exec(withPanel)![1])
  const onPanel = Number(/([\d.]+):1 on Budget TN/.exec(withPanel)![1])
  expect(onPanel).toBeLessThan(here)
  expect(here).toBeCloseTo(4.8, 1)
})

test('a click pins the readout; leaving keeps it; a second click lets go', async () => {
  // Measured by the previous test: the footer is the inspector's now and no
  // longer states the magnification.
  await page.mouse.move(greyPoint.x, greyPoint.y)
  await expect.poll(footer).toContain('p#grey')
  await page.mouse.down()
  await page.mouse.up()
  await expect.poll(footer).toContain('pinned')

  // Off the canvas entirely: the pinned report stays.
  await page.mouse.move(2, 2)
  await new Promise(r => setTimeout(r, 300))
  expect(await footer()).toContain('p#grey')

  const canvas = (await page.locator('.target-canvas').boundingBox())!
  await page.mouse.move(canvas.x + 5, canvas.y + 5)
  await page.mouse.down()
  await page.mouse.up()
  await expect.poll(footer).not.toContain('pinned')
  await page.mouse.move(2, 2)
  await expect.poll(footer).toContain('hover the target')
})

test('switching the inspector off restores the target readout and the cursor', async () => {
  await page.click('.inspect-toggle')
  await expect(page.locator('.inspect-toggle')).toHaveAttribute('aria-pressed', 'false')
  await expect(page.locator('.target-pane .pane-footer .role')).toHaveText('TARGET')
  await expect(page.locator('.target-canvas')).not.toHaveClass(/inspecting/)
  await expect(page.locator('.inspect-highlight')).toHaveCount(0)
})
