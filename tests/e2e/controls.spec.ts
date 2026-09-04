import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { closeSettings, launchApp, openSettings, rendererWindow } from './launch'
import { drawerSettled } from './helpers/select'
import { choose } from './helpers/select'

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

/**
 * Opens the panel drawer whatever is open now; each test owns its own state.
 * Settings is no longer a drawer — see `openSettings`.
 */
const openPanel = async (): Promise<void> => {
  // The modal blocks the toolbar while it is up, as a modal should, so it has
  // to go before the drawer button is reachable.
  await closeSettings(page)
  const button = page.locator('.toggle-panel')
  if ((await button.getAttribute('aria-pressed')) !== 'true') await button.click()
  await expect(page.locator('.drawer .nits-slider')).toHaveCount(1)
  // The drawer slides in; the pane measurements below need it landed.
  await drawerSettled(page, true)
}

test.beforeAll(async () => {
  app = await launchApp()
  page = await rendererWindow(app)
  // The canvas is sized from the viewport and scale, so it has a real size as
  // soon as the shell's first render has landed.
  await expect.poll(() => backingWidth(page)).toBeGreaterThan(0)
  // 1:1 explicitly. This spec reads magnification off the backing store, and
  // fit — the app's opening view — clamps the drawn scale to whatever shows
  // the whole viewport, which would swallow the very change being measured.
  await page.click('.view-1x')
  await expect(page.locator('.view-1x')).toHaveAttribute('aria-pressed', 'true')
})
test.afterAll(async () => {
  await app.close()
})

test('the sliders override the profile, and picking a profile resets them', async () => {
  await openPanel()
  await choose(app, page, '.profile-select', 'budget-tn')
  await expect(page.locator('.bits-select')).toHaveValue('6')

  await page.selectOption('.bits-select', '8')
  await expect(page.locator('.bits-select')).toHaveValue('8')
  // Still 8 after a redraw: the override outranks the profile.
  await expect(page.locator('.frc-check')).toBeChecked()
  // And the readout says so.
  await expect(page.locator('.target-pane .pane-footer')).toContainText('Custom panel')

  await choose(app, page, '.profile-select', 'old-laptop')
  await expect(page.locator('.bits-select')).toHaveValue('6')
  await expect(page.locator('.frc-check')).not.toBeChecked()
  await expect(page.locator('.target-pane .pane-footer')).toContainText('Old laptop')
})

test('a bigger host diagonal means a smaller magnification', async () => {
  await openSettings(page, 'display')
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
  await openSettings(page, 'display')
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
  await openSettings(page, 'display')
  await enter('.host-nits', '420')
  await expect.poll(storedSettings).toMatchObject({ hostDiagonalInches: 32, hostNits: 420, agentControl: false })
})

test('an invalid setting is refused without taking the app down', async () => {
  await openSettings(page, 'display')
  const field = page.locator('.host-diagonal')
  // A zero diagonal would make `ppi` throw and main refuse it: leaving the
  // field keeps the last good value, shows why, and snaps the field back.
  await field.fill('0')
  await field.blur()
  await expect(page.locator('.settings-modal .field-error')).toBeVisible()
  await expect(field).toHaveValue('32')
  await expect.poll(storedSettings).toMatchObject({ hostDiagonalInches: 32, hostNits: 420, agentControl: false })
  // The flat-2x fallback is not in play: the calibrated scale survived.
  await expect(page.locator('.settings-modal .warn')).toHaveCount(0)

  await enter('.host-diagonal', '27')
  await expect(page.locator('.settings-modal .field-error')).toHaveCount(0)
  await expect.poll(storedSettings).toMatchObject({ hostDiagonalInches: 27, hostNits: 420, agentControl: false })
})

test('an oversized custom screen clamps and says so in the toolbar', async () => {
  await openSettings(page, 'screens')
  await enter('.custom-width', '6000')

  await expect(page.locator('.preset-select')).toHaveAttribute('data-value', 'custom')
  await expect(page.locator('.chrome .warn')).toContainText('clamped to 4096')
})

test('the panel drawer narrows the panes and the native view follows', async () => {
  const slot = () =>
    page.evaluate(() => {
      const r = document.querySelector('.native-slot')!.getBoundingClientRect()
      return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) }
    })
  // The panel sliders, not settings: this narrowing is exactly why they stayed
  // a drawer. You tune contrast against the render, so the render has to be on
  // screen beside the control.
  await openPanel()
  const withDrawer = await slot()
  await expect.poll(() => app.evaluate(() => (globalThis as any).__obsrv.native.getBounds())).toEqual(withDrawer)

  // Closing the drawer gives the width back to the panes.
  await page.click('.toggle-panel')
  await expect(page.locator('.drawer')).toHaveCount(0)
  await expect.poll(async () => (await slot()).width).toBeGreaterThan(withDrawer.width)
  await expect.poll(() => app.evaluate(() => (globalThis as any).__obsrv.native.getBounds())).toEqual(await slot())
})

test('the settings modal covers the panes and takes the native view off screen', async () => {
  const visible = (): Promise<boolean> =>
    app.evaluate(() => (globalThis as any).__obsrv.native.isVisible() as boolean)
  await closeSettings(page)
  // A page-less tab has no native view to begin with (see empty-state.spec.ts),
  // and this test is about the modal taking it away, not about that. A real
  // fixture, not `about:blank`: a tab's first blank commit is deliberately
  // swallowed, so that would leave the tab still counting as never navigated.
  await page.evaluate(
    u => window.obsrv.navigate(u),
    pathToFileURL(resolve(__dirname, '../fixtures/hairline.html')).href,
  )
  await expect.poll(visible).toBe(true)

  // The view is composited above this window's DOM, so it would punch a hole
  // through the modal. Hiding it is right here — unlike the menus, which are
  // transient and drawn in the overlay view instead.
  await openSettings(page)
  await expect.poll(visible).toBe(false)
  await closeSettings(page)
  await expect.poll(visible).toBe(true)
})

test('the view control is three-way, and Fit outranks pixel-exact', async () => {
  const pressed = async (): Promise<string[]> =>
    page.locator('.view-control button[aria-pressed="true"]').evaluateAll(els =>
      els.map(e => e.className),
    )
  // Exactly one at a time, or the row would be claiming two magnifications.
  await page.click('.view-pixels')
  expect(await pressed()).toEqual(['view-pixels'])
  await page.click('.view-1x')
  expect(await pressed()).toEqual(['view-1x'])
  await page.click('.view-fit')
  expect(await pressed()).toEqual(['view-fit'])

  // Pixel-exact is inert under Fit: its scale overrides. Coming back from Fit
  // to "Pixels" must therefore re-assert it rather than assume it survived.
  await page.click('.view-pixels')
  await expect(page.locator('.view-pixels')).toHaveAttribute('aria-pressed', 'true')
  await page.click('.view-fit')
  await expect(page.locator('.view-pixels')).toHaveAttribute('aria-pressed', 'false')
  await page.click('.view-pixels')
  await expect(page.locator('.view-pixels')).toHaveAttribute('aria-pressed', 'true')
})

test('"Actual" and "Pixels" are different magnifications, and the footer says so', async () => {
  const magnification = async (): Promise<string> =>
    (await page.locator('.pane.target-pane .pane-footer').textContent()) ?? ''

  await choose(app, page, '.preset-select', 'iphone-61')
  await page.click('.view-1x')
  const actual = await magnification()
  await page.click('.view-pixels')
  const pixels = await magnification()

  // A 6.1" phone at 3x is physically smaller than a host pixel, so actual size
  // and pixel-exact cannot agree — if they did, one of the two would be a lie.
  expect(actual).not.toBe(pixels)
  // Fit disclaims itself, and only Fit does.
  await page.click('.view-fit')
  expect(await magnification()).toContain('not pixel-exact')
  await page.click('.view-pixels')
  expect(await magnification()).not.toContain('not pixel-exact')
})
