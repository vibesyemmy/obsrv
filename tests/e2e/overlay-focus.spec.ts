import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { launchApp, rendererWindow } from './launch'
import { menuKey, menuRows, waitForMenu } from './helpers/select'

/**
 * The overlay's keyboard focus hand-off, in a real window
 * (bug-overlay-focus-handoff-untested). Opening a menu hands keyboard focus to
 * the overlay's webContents; closing it hands focus back to the chrome, or the
 * next keystroke lands nowhere. The rest of the suite cannot see either: under
 * the harness `focusView` skips both so the app never takes the desk, and
 * `menuKey` sends its keys to the overlay directly, whichever webContents holds
 * focus. So this spec's app is launched to take the desk, and the spec runs on
 * CI, or locally only with OBSRV_E2E_FRONT=1. tests/unit/overlay.test.ts
 * checks the calls are made; this checks what Electron reports they did.
 */

const FRONTS = Boolean(process.env['CI'] || process.env['OBSRV_E2E_FRONT'])

let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  if (!FRONTS) return
  app = await launchApp([], process.env['CI'] || process.env['OBSRV_E2E_FRONT'] ? { OBSRV_TEST_TAKES_THE_DESK: '1' } : {})
  page = await rendererWindow(app)
})

test.afterAll(async () => {
  await app?.close()
})

/** Whether the window is focused, and which of its webContents Electron says holds keyboard focus. */
const focus = (): Promise<{ window: boolean; chrome: boolean; overlay: boolean }> =>
  app.evaluate(() => {
    const o = (globalThis as any).__obsrv
    return { window: o.win.isFocused(), chrome: o.win.webContents.isFocused(), overlay: o.overlay.webContents.isFocused() }
  })

test('a menu takes keyboard focus from the chrome and gives it back when it closes (takes the desk: CI, or locally with OBSRV_E2E_FRONT=1)', async () => {
  test.skip(!FRONTS, 'takes the desk: runs on CI, or locally with OBSRV_E2E_FRONT=1')
  // With no focused window there is no hand-off to see. Some runners refuse
  // focus (live-drive's focusWindow test allows for it), and this test says so
  // rather than passing without having looked.
  let granted = false
  for (let i = 0; i < 30 && !granted; i++) {
    granted = (await focus()).window
    if (!granted) await new Promise(r => setTimeout(r, 100))
  }
  test.skip(!granted, 'the runner did not grant the window focus, so there is no hand-off to see')

  await page.locator('.preset-select').focus()
  await expect.poll(focus).toEqual({ window: true, chrome: true, overlay: false })

  await page.keyboard.press('ArrowDown')
  await waitForMenu(app)
  await expect.poll(focus).toEqual({ window: true, chrome: false, overlay: true })

  await menuKey(app, 'Escape')
  await expect.poll(() => menuRows(app).then(r => r.length)).toBe(0)
  await expect.poll(focus).toEqual({ window: true, chrome: true, overlay: false })
})
