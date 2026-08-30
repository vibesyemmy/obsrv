import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { launchApp, rendererWindow } from './launch'
import { decodePng, pixelAt } from './helpers/decodePng'

test.describe.configure({ mode: 'serial' })

let app: ElectronApplication
let page: Page

const FIXTURE = pathToFileURL(resolve(__dirname, '../fixtures/solid-red.html')).href

test.beforeAll(async () => {
  app = await launchApp()
  page = await rendererWindow(app)
  await page.evaluate(u => window.obsrv.navigate(u), FIXTURE)
  await page.click('.toggle-panel')
  await expect(page.locator('.drawer .vision-control')).toHaveCount(1)
})
test.afterAll(async () => {
  await app.close()
})

const footer = () => page.locator('.pane.target-pane .pane-footer')

test('the simulation is off until it is asked for, and the footer stays quiet', async () => {
  await expect(page.locator('.vision-none')).toHaveAttribute('aria-pressed', 'true')
  // The readout names the simulation only when one is running: a permanent
  // "Normal 100%" would be noise, and worse, would train the eye to skip it.
  await expect(footer()).not.toContainText('Deutan')
  await expect(footer()).not.toContainText('Normal')
})

test('choosing a deficiency names it in the footer, with its severity', async () => {
  await page.click('.vision-deutan')
  await expect(page.locator('.vision-deutan')).toHaveAttribute('aria-pressed', 'true')
  // The pane's footer is what a capture is read against, so it has to say both
  // which deficiency and how strong — 40% deutan and full deutan are different
  // pictures of the same page.
  await expect(footer()).toContainText('Deutan 100%')

  await page.locator('.vision-severity').fill('40')
  await expect(footer()).toContainText('Deutan 40%')
})

test('it actually changes the render, and turning it off restores it', async () => {
  // Through main's capturePage, not the canvas: the app does not preserve its
  // drawing buffer, so `readPixels` after the frame is composited comes back
  // black. This reads what is genuinely on screen.
  const middle = async (): Promise<[number, number, number]> => {
    // Cropped to the target canvas. The whole window would centre on the seam,
    // and the half left of it is the native pane — which is correctly *not*
    // simulated, so sampling there would prove the opposite of the point.
    const box = (await page.locator('.target-pane canvas').boundingBox())!
    const rect = {
      x: Math.round(box.x),
      y: Math.round(box.y),
      width: Math.round(box.width),
      height: Math.round(box.height),
    }
    const b64: string = await app.evaluate(async ({}, r) => {
      const img = await (globalThis as any).__obsrv.win.webContents.capturePage(r)
      return img.toPNG().toString('base64')
    }, rect)
    const png = decodePng(Buffer.from(b64, 'base64'))
    const [r, g, bl] = pixelAt(png, Math.floor(png.width / 2), Math.floor(png.height / 2))
    return [r, g, bl]
  }

  await page.click('.vision-none')
  const normal = await middle()
  // The fixture is solid red, so this is a real red before anything touches it.
  expect(normal[0]).toBeGreaterThan(normal[1]! + 40)

  await page.click('.vision-protan')
  await page.locator('.vision-severity').fill('100')
  await expect.poll(async () => (await middle())[0]).toBeLessThan(normal[0]! - 20)

  // Protan darkens red as well as shifting it — the part a hue-only account of
  // these conditions misses, and the reason red-on-dark warnings fail for it.
  await page.click('.vision-none')
  await expect.poll(async () => (await middle())[0]).toBeGreaterThan(normal[0]! - 10)
})

test('an agent can drive it, and status reports what is showing', async () => {
  await page.click('.vision-tritan')
  await expect
    .poll(() => app.evaluate(() => (globalThis as any).__obsrv.session.visionType as string))
    .toBe('tritan')

  // Main mirrors it for the control server, so `obsrv_drive` and `obsrv_snap`
  // can never photograph a simulated render and describe it as a plain one.
  await page.click('.vision-none')
  await expect
    .poll(() => app.evaluate(() => (globalThis as any).__obsrv.session.visionType as string))
    .toBe('none')
})

test('it survives a tab switch, because it belongs to the tab', async () => {
  await page.click('.vision-achromat')
  await expect(footer()).toContainText('Achromat')

  await page.locator('.tab-new').click()
  await expect(footer()).not.toContainText('Achromat')

  await page.locator('.chrome-tabs [role="tab"]').nth(0).click()
  await expect(footer()).toContainText('Achromat')
})
