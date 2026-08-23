import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { launchApp, rendererWindow } from './launch'

let app: ElectronApplication
let page: Page

const backingWidth = (p: Page) =>
  p.evaluate(() => (document.querySelector('.target-pane canvas') as HTMLCanvasElement).width)

const storedSettings = () => page.evaluate(() => (window as any).obsrv.getSettings())

/** Types into a settings field and commits it the way a person does: Enter. */
const enter = async (selector: string, value: string): Promise<void> => {
  await page.fill(selector, value)
  await page.press(selector, 'Enter')
}

/** Opens the named drawer whatever is open now; each test owns its drawer state. */
const openDrawer = async (which: 'panel' | 'settings'): Promise<void> => {
  const button = page.locator(`.toggle-${which}`)
  if ((await button.getAttribute('aria-pressed')) !== 'true') await button.click()
  await expect(button).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.drawer')).toHaveCount(1)
}

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
  await openDrawer('panel')
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
  await openDrawer('settings')
  await enter('.host-diagonal', '27')
  await expect.poll(storedSettings).toMatchObject({ hostDiagonalInches: 27 })
  const at27 = await backingWidth(page)

  await enter('.host-diagonal', '54')
  await expect.poll(storedSettings).toMatchObject({ hostDiagonalInches: 54 })
  // S = hostPPI / targetPPI, and hostPPI is inversely proportional to the
  // diagonal, so doubling the diagonal halves the magnification.
  expect(at27).toBeGreaterThan(0)
  await expect.poll(async () => Math.abs((await backingWidth(page)) - at27 / 2)).toBeLessThanOrEqual(2)
})

test('a field commits on blur or Enter, never on a keystroke', async () => {
  await openDrawer('settings')
  const field = page.locator('.host-diagonal')
  // Typing "32" passes through "3", which would be a 3-inch display.
  const before = await backingWidth(page)
  await field.fill('')
  await field.pressSequentially('32')
  await expect(field).toHaveValue('32')
  // A keystroke commit would have resized the canvas synchronously and
  // reached main by now.
  await page.waitForTimeout(200)
  expect(await backingWidth(page)).toBe(before)
  expect(await storedSettings()).toMatchObject({ hostDiagonalInches: 54 })

  await field.blur()
  await expect.poll(storedSettings).toMatchObject({ hostDiagonalInches: 32 })

  // Escape discards an edit.
  await field.fill('40')
  await field.press('Escape')
  await expect(field).toHaveValue('32')
  await expect.poll(storedSettings).toMatchObject({ hostDiagonalInches: 32 })
})

test('settings persist through main', async () => {
  await openDrawer('settings')
  await enter('.host-nits', '420')
  await expect.poll(storedSettings).toEqual({ hostDiagonalInches: 32, hostNits: 420 })
})

test('an invalid setting is refused without taking the app down', async () => {
  await openDrawer('settings')
  const field = page.locator('.host-diagonal')
  // A zero diagonal would make `ppi` throw and main refuse it: leaving the
  // field keeps the last good value, shows why, and snaps the field back.
  await field.fill('0')
  await field.blur()
  await expect(page.locator('.drawer .field-error')).toBeVisible()
  await expect(field).toHaveValue('32')
  await expect.poll(storedSettings).toEqual({ hostDiagonalInches: 32, hostNits: 420 })
  // The flat-2x fallback is not in play: the calibrated scale survived.
  await expect(page.locator('.drawer .warn')).toHaveCount(0)

  await enter('.host-diagonal', '27')
  await expect(page.locator('.drawer .field-error')).toHaveCount(0)
  await expect.poll(storedSettings).toEqual({ hostDiagonalInches: 27, hostNits: 420 })
})

test('an oversized custom screen clamps and says so in the toolbar', async () => {
  await openDrawer('settings')
  await enter('.custom-width', '6000')

  await expect(page.locator('.preset-select')).toHaveValue('custom')
  await expect(page.locator('.toolbar .warn')).toContainText('clamped to 4096')
})

test('a drawer narrows the panes and the native view follows', async () => {
  const slot = () =>
    page.evaluate(() => {
      const r = document.querySelector('.native-slot')!.getBoundingClientRect()
      return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) }
    })
  await openDrawer('settings')
  const withDrawer = await slot()
  await expect.poll(() => app.evaluate(() => (globalThis as any).__obsrv.native.getBounds())).toEqual(withDrawer)

  // Closing the drawer gives the width back to the panes.
  await page.click('.toggle-settings')
  await expect(page.locator('.drawer')).toHaveCount(0)
  await expect.poll(async () => (await slot()).width).toBeGreaterThan(withDrawer.width)
  await expect.poll(() => app.evaluate(() => (globalThis as any).__obsrv.native.getBounds())).toEqual(await slot())
})
