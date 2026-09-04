import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { choose } from './helpers/select'
import { launchApp, rendererWindow } from './launch'

/**
 * Fit never enlarges past true size, and true size is one thing: the
 * physical 1:1, whatever the pixel-exact flag says. The flag belongs to the
 * 1:1 view and stays set underneath Fit, so a Fit reached from Pixels used
 * to cap at the host's pixel-exact scale instead and show a different
 * picture from a Fit reached from Actual — the whole pane against true
 * size in a wide window.
 */

const TALL = pathToFileURL(resolve(__dirname, '../fixtures/tall.html')).href

let app: ElectronApplication
let page: Page

const readout = (): Promise<{ footer: string; width: number }> =>
  page.evaluate(() => ({
    footer: (document.querySelector('.target-pane .pane-footer') as HTMLElement).innerText.replace(/\s+/g, ' '),
    width: Math.round(document.querySelector('.target-canvas')!.getBoundingClientRect().width),
  }))
const fitScaleOf = (footer: string): number => Number(/fit ×([\d.]+)/.exec(footer)?.[1] ?? NaN)

test.beforeAll(async () => {
  app = await launchApp()
  page = await rendererWindow(app)
  await page.evaluate(u => window.obsrv.navigate(u), TALL)
  // A pane the phone fits in with room to spare, so that a cap that moved
  // would show: at true size the phone is a fraction of the pane.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1900, 1100))
  await page.click('.panes-target')
  await choose(app, page, '.preset-select', 'android-65')
  await expect.poll(() => page.locator('.target-canvas').evaluate(el => el.getBoundingClientRect().width)).toBeGreaterThan(0)
})
test.afterAll(async () => {
  await app.close()
})

test('Fit shows the same picture whether it is reached from Actual or from Pixels', async () => {
  await page.click('.view-1x')
  await expect.poll(() => readout().then(r => r.footer)).toContain('×')
  const actual = await readout()

  await page.click('.view-fit')
  await expect.poll(() => readout().then(r => r.footer)).toContain('fit ×')
  const fromActual = await readout()

  await page.click('.view-pixels')
  await expect.poll(() => readout().then(r => r.footer)).toContain('×1.00')
  const pixels = await readout()
  expect(pixels.width).toBeGreaterThan(actual.width)

  await page.click('.view-fit')
  await expect.poll(() => readout().then(r => r.footer)).toContain('fit ×')
  const fromPixels = await readout()

  // The same fit, to the hundredth, and the same canvas to the pixel.
  expect(fitScaleOf(fromPixels.footer)).toBeCloseTo(fitScaleOf(fromActual.footer), 2)
  expect(fromPixels.width).toBe(fromActual.width)
  // And that fit is true size, since the phone fits: the Actual canvas.
  expect(fromActual.width).toBe(actual.width)
})
