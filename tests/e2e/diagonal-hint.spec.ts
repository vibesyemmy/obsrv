import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp, rendererWindow } from './launch'

/**
 * The first window says when the render is not at true physical size
 * (`ux-first-launch-no-calibration`).
 *
 * The magnification divides by `hostDiagonalInches`, which defaults to 27, so
 * on a smaller screen the target rendered below true size and the window said
 * nothing about it. The hint says it, and goes quiet only when the diagonal was
 * set for the display the window is on.
 *
 * Desk-safe: it launches the app as every other local spec does, reads the
 * renderer and clicks a button in it. No `show`, `focus` or `moveTop`, and no
 * preset cycling.
 */

const HINT = '.pane-hint'
const TEXT = '.pane-hint-text'

/** The display main reported, as the settings field records it. */
const hostKey = async (app: ElectronApplication, page: Page): Promise<{ physicalWidth: number; physicalHeight: number }> => {
  const host = await page.evaluate(() => window.obsrv.getHostInfo())
  expect(host.physicalWidth, 'the runner reported no display, so nothing below is about calibration').toBeGreaterThan(0)
  return { physicalWidth: host.physicalWidth, physicalHeight: host.physicalHeight }
}

const persisted = (app: ElectronApplication): Promise<unknown> =>
  app.evaluate(() => (globalThis as unknown as { __obsrv: { persistedSettings: () => unknown } }).__obsrv.persistedSettings())

test.describe('a fresh profile: nobody has set the diagonal', () => {
  let app: ElectronApplication
  let page: Page

  test.beforeAll(async () => {
    app = await launchApp()
    page = await rendererWindow(app)
  })
  test.afterAll(async () => {
    await app?.close()
  })

  test('the first window says the render assumes the default screen size, and the whole sentence is in the pane', async () => {
    // The wording is owned by `diagonalHint.test.ts`; this is the sentence
    // reaching a real window, at the size it is really shown at.
    await expect(page.locator(TEXT)).toHaveText(
      'this render assumes a 27″ screen, the default, so it is not at true physical size unless this screen is 27″',
    )
    // Visible, not merely present: the footer strip clips, which is why the
    // hint has its own row, and a clipped warning would be no warning.
    const text = page.locator(TEXT)
    await expect(text).toBeVisible()
    const box = (await text.boundingBox())!
    const scrollWidth = await text.evaluate(el => el.scrollWidth)
    expect(Math.ceil(box.width), `the sentence is clipped: ${scrollWidth}px of text in ${box.width}px`).toBeGreaterThanOrEqual(scrollWidth)
  })

  test('confirming records this display and ends the hint, without changing the number', async () => {
    const key = await hostKey(app, page)
    await page.getByRole('button', { name: '27″ is right' }).click()
    await expect(page.locator(HINT)).toHaveCount(0)
    // On disk, not just in the store: a hint that came back on the next launch
    // would be the nag this card exists to prevent.
    await expect.poll(() => persisted(app)).toMatchObject({ hostDiagonalInches: 27, hostDiagonalSetFor: [key] })
  })

  test('the same profile on another display says which display it was set on, rather than going quiet', async () => {
    const key = await hostKey(app, page)
    // A display change is what main pushes when the window is dragged to
    // another monitor (`ipc.ts`, `hostChanged`). Pushed here rather than
    // moving the window: the display is the runner's, and a spec that moved
    // windows would not be desk-safe.
    const sent = await app.evaluate(({ BrowserWindow }, other) => {
      const wins = BrowserWindow.getAllWindows()
      for (const w of wins) w.webContents.send('obsrv:host-changed', other)
      return wins.length
    }, { physicalWidth: 3840, physicalHeight: 2160, scaleFactor: 2 })
    expect(sent, 'no window to push a display change to').toBeGreaterThan(0)
    await expect(page.locator(TEXT)).toHaveText(
      `screen size was set on a ${key.physicalWidth}×${key.physicalHeight} display; this one is 3840×2160, so this render assumes 27″`,
    )
    // And the way out names this screen instead of the other one.
    await expect(page.getByRole('button', { name: 'Set size for this screen' })).toBeVisible()
  })
})

test.describe('an older profile: a diagonal set before Obsrv recorded which screen', () => {
  let app: ElectronApplication
  let page: Page

  test.beforeAll(async () => {
    // A settings file as a pre-field version wrote it: a chosen diagonal, and
    // no record of the display it was chosen for.
    const dir = mkdtempSync(join(tmpdir(), 'obsrv-e2e-legacy-'))
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ hostDiagonalInches: 24, hostNits: 500, agentControl: false }))
    app = await launchApp([], {}, dir)
    page = await rendererWindow(app)
  })
  test.afterAll(async () => {
    await app?.close()
  })

  test('says the size was set before the screen was recorded, and asks once', async () => {
    await expect(page.locator(TEXT)).toHaveText('24″ was set before Obsrv recorded which screen it was for')
    const key = await hostKey(app, page)
    await page.getByRole('button', { name: 'Right for this screen' }).click()
    await expect(page.locator(HINT)).toHaveCount(0)
    await expect.poll(() => persisted(app)).toMatchObject({ hostDiagonalInches: 24, hostDiagonalSetFor: [key] })
  })
})
