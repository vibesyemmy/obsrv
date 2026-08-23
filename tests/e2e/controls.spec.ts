import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { launchApp, rendererWindow } from './launch'

let app: ElectronApplication
let page: Page

const backingWidth = (p: Page) =>
  p.evaluate(() => (document.querySelector('.target-pane canvas') as HTMLCanvasElement).width)

const storedSettings = () => page.evaluate(() => (window as any).obsrv.getSettings())

test.beforeAll(async () => {
  app = await launchApp()
  page = await rendererWindow(app)
  // The canvas is sized from the viewport and scale, so it has a real size as
  // soon as the shell's first render has landed.
  await expect.poll(() => backingWidth(page)).toBeGreaterThan(0)
})
test.afterAll(async () => {
  await app.close()
})

test('the sliders override the profile, and picking a profile resets them', async () => {
  await page.click('.toggle-panel')
  await page.selectOption('.profile-select', 'budget-tn')
  await expect(page.locator('.bits-select')).toHaveValue('6')

  await page.selectOption('.bits-select', '8')
  await expect(page.locator('.bits-select')).toHaveValue('8')
  // Still 8 after a redraw: the override outranks the profile.
  await expect(page.locator('.frc-check')).toBeChecked()
  // And the readout says so.
  await expect(page.locator('.target-pane .pane-footer')).toContainText('Custom panel')

  await page.selectOption('.profile-select', 'old-laptop')
  await expect(page.locator('.bits-select')).toHaveValue('6')
  await expect(page.locator('.frc-check')).not.toBeChecked()
  await expect(page.locator('.target-pane .pane-footer')).toContainText('Old laptop')
})

test('a bigger host diagonal means a smaller magnification', async () => {
  await page.click('.toggle-settings')
  await page.fill('.host-diagonal', '27')
  await expect.poll(storedSettings).toMatchObject({ hostDiagonalInches: 27 })
  const at27 = await backingWidth(page)

  await page.fill('.host-diagonal', '54')
  await expect.poll(storedSettings).toMatchObject({ hostDiagonalInches: 54 })
  // S = hostPPI / targetPPI, and hostPPI is inversely proportional to the
  // diagonal, so doubling the diagonal halves the magnification.
  expect(at27).toBeGreaterThan(0)
  await expect.poll(async () => Math.abs((await backingWidth(page)) - at27 / 2)).toBeLessThanOrEqual(2)
})

test('settings persist through main', async () => {
  await page.fill('.host-nits', '420')
  await expect.poll(storedSettings).toEqual({ hostDiagonalInches: 54, hostNits: 420 })
})

test('an invalid setting is refused without taking the app down', async () => {
  // A half-typed field is not committed: main keeps the last good value and
  // the panel says why, rather than throwing on a zero diagonal.
  await page.fill('.host-diagonal', '0')
  await expect(page.locator('.drawer .field-error')).toBeVisible()
  await expect.poll(storedSettings).toEqual({ hostDiagonalInches: 54, hostNits: 420 })

  await page.fill('.host-diagonal', '32')
  await expect(page.locator('.drawer .field-error')).toHaveCount(0)
  await expect.poll(storedSettings).toEqual({ hostDiagonalInches: 32, hostNits: 420 })
})

test('an oversized custom screen clamps and says so in the toolbar', async () => {
  await page.fill('.custom-width', '6000')

  await expect(page.locator('.preset-select')).toHaveValue('custom')
  await expect(page.locator('.toolbar .warn')).toContainText('clamped to 4096')
})

test('a drawer narrows the panes and the native view follows', async () => {
  const slot = () =>
    page.evaluate(() => {
      const r = document.querySelector('.native-slot')!.getBoundingClientRect()
      return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) }
    })
  const withDrawer = await slot()
  await expect.poll(() => app.evaluate(() => (globalThis as any).__obsrv.native.getBounds())).toEqual(withDrawer)

  // Closing the open settings drawer gives the width back to the panes.
  await page.click('.toggle-settings')
  await expect(page.locator('.drawer')).toHaveCount(0)
  await expect.poll(async () => (await slot()).width).toBeGreaterThan(withDrawer.width)
  await expect.poll(() => app.evaluate(() => (globalThis as any).__obsrv.native.getBounds())).toEqual(await slot())
})
