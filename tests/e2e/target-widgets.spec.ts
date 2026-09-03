import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { pickerHost, setPickerValue, waitForPicker } from './helpers/picker'
import { menuKey, menuRows, menuTicked, pickMenu, waitForMenu } from './helpers/select'
import { launchApp, rendererWindow } from './launch'

/**
 * The target is an offscreen window drawn onto a canvas, and two things a
 * page does through the window rather than through its pixels were lost on
 * the way: the cursor it asks for, and the popup of a <select>. The first
 * is forwarded (shared/cursor.ts); the second is drawn by Obsrv in the
 * overlay menu (shared/selectPopup.ts). Both are exercised here the way a
 * user reaches them — through the canvas — and checked in the page.
 */

const FIXTURE = pathToFileURL(resolve(__dirname, '../fixtures/native-widgets.html')).href

let app: ElectronApplication
let page: Page

const inTarget = <T,>(code: string): Promise<T> =>
  app.evaluate(({}, c: string) => (globalThis as any).__obsrv.target.webContents.executeJavaScript(c), code)
const footer = (): Promise<string> => page.locator('.target-pane .pane-footer').innerText()

/** Canvas coordinates of a CSS point of the target viewport, at the pane's current magnification. */
async function canvasPoint(cssX: number, cssY: number): Promise<{ x: number; y: number }> {
  const box = (await page.locator('.target-canvas').boundingBox())!
  const text = await footer()
  const fit = /fit ×([\d.]+)/.exec(text)
  const one = /×([\d.]+)/.exec(text)
  const scale = Number(fit?.[1] ?? one?.[1])
  const dsf: number = await app.evaluate(() => (globalThis as any).__obsrv.target.getDeviceScaleFactor())
  const dpr = await page.evaluate(() => window.devicePixelRatio)
  const k = (scale * dsf) / dpr
  return { x: box.x + cssX * k, y: box.y + cssY * k }
}

/** The centre of an element of the page, as a canvas point. */
async function centreOf(id: string): Promise<{ x: number; y: number }> {
  const r = await inTarget<{ x: number; y: number }>(
    `(() => { const r = document.getElementById(${JSON.stringify(id)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`,
  )
  return canvasPoint(r.x, r.y)
}

const canvasCursor = (): Promise<string> => page.locator('.target-canvas').evaluate(el => getComputedStyle(el).cursor)
const pageLog = (): Promise<string[]> => inTarget<string[]>('window.__log')

test.beforeAll(async () => {
  app = await launchApp()
  page = await rendererWindow(app)
  await page.fill('.url-form input', FIXTURE)
  await page.press('.url-form input', 'Enter')
  await expect.poll(() => inTarget<string>('document.title'), { timeout: 10_000 }).toBe('native-widgets')
  await expect.poll(() => page.evaluate(() => document.querySelector<HTMLCanvasElement>('canvas.target-canvas')?.dataset.gl)).toBe('ok')
})
test.afterAll(async () => {
  await app.close()
})

test('the canvas wears the page cursor: the hand over a link, the arrow off it', async () => {
  const link = await centreOf('link')
  await page.mouse.move(link.x, link.y)
  await expect.poll(canvasCursor).toBe('pointer')
  const empty = await canvasPoint(600, 700)
  await page.mouse.move(empty.x, empty.y)
  await expect.poll(canvasCursor).toBe('default')
})

test("a page's own image cursor comes through as that image", async () => {
  const custom = await centreOf('custom')
  await page.mouse.move(custom.x, custom.y)
  await expect.poll(canvasCursor).toMatch(/^url\("data:image\/png;base64,/)
  const empty = await canvasPoint(600, 700)
  await page.mouse.move(empty.x, empty.y)
  await expect.poll(canvasCursor).toBe('default')
})

test('clicking a <select> opens its rows in the overlay menu; a pick lands in the page with input and change', async () => {
  const sel = await centreOf('sel')
  await page.mouse.click(sel.x, sel.y)
  await waitForMenu(app)
  // Rows are option indexes; the disabled one is left out, the optgroup is a group.
  expect(await menuRows(app)).toEqual(['0', '1', '3', '4'])
  expect(await menuTicked(app)).toBe('0')
  await pickMenu(app, '3')
  await expect.poll(() => inTarget<string>("document.getElementById('sel').value")).toBe('Delta')
  const log = await pageLog()
  expect(log).toContain('mousedown:sel')
  expect(log).toContain('focus:sel')
  expect(log).toContain('input:sel')
  expect(log).toContain('change:sel')
  // The page's select keeps focus, and the menu is gone.
  expect(await inTarget<string>('document.activeElement.id')).toBe('sel')
  await expect.poll(() => menuRows(app).then(r => r.length)).toBe(0)
})

test('Escape dismisses without a change; Space on the focused select reopens it', async () => {
  const before = (await pageLog()).length
  const sel = await centreOf('sel')
  await page.mouse.click(sel.x, sel.y)
  await waitForMenu(app)
  expect(await menuTicked(app)).toBe('3')
  await menuKey(app, 'Escape')
  await expect.poll(() => menuRows(app).then(r => r.length)).toBe(0)
  expect(await inTarget<string>("document.getElementById('sel').value")).toBe('Delta')
  expect((await pageLog()).slice(before).filter(l => l.startsWith('change'))).toEqual([])

  // The select is still the page's focused element; the canvas has focus in
  // the chrome, so a Space there is forwarded and reopens the menu.
  await expect(page.locator('.target-canvas')).toBeFocused()
  await page.keyboard.press('Space')
  await waitForMenu(app)
  await menuKey(app, 'Escape')
  await expect.poll(() => menuRows(app).then(r => r.length)).toBe(0)
})

test('a listbox <select multiple> is left to the page: it renders in-page and takes the click itself', async () => {
  const two = await inTarget<{ x: number; y: number }>(
    `(() => { const r = document.querySelector('#multi option:nth-child(2)').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`,
  )
  const p = await canvasPoint(two.x, two.y)
  await page.mouse.click(p.x, p.y)
  await expect.poll(() => inTarget<string>("document.getElementById('multi').value")).toBe('Two')
  expect(await menuRows(app)).toEqual([])
})

test('the native pane still opens its own select popups: the hook is the target\'s alone', async () => {
  const flag = await app.evaluate(() => {
    const ctx = (globalThis as any).__obsrv
    return {
      target: ctx.target.webContents.getURL(),
      native: ctx.native.webContents.getURL(),
    }
  })
  expect(flag.target).toBe(flag.native)
  // The native pane's document was never given the target's argument, so a
  // mousedown on its select is not prevented: Chromium's own default runs.
  const prevented = await app.evaluate(() =>
    (globalThis as any).__obsrv.native.webContents.executeJavaScript(
      `(() => { const s = document.getElementById('sel'); const e = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }); s.dispatchEvent(e); return e.defaultPrevented })()`,
    ),
  )
  expect(prevented).toBe(false)
  const preventedInTarget = await inTarget<boolean>(
    `(() => { const s = document.getElementById('sel'); const e = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }); s.dispatchEvent(e); return e.defaultPrevented })()`,
  )
  expect(preventedInTarget).toBe(true)
  // That synthetic press asked for a menu; dismiss it.
  await waitForMenu(app)
  await menuKey(app, 'Escape')
  await expect.poll(() => menuRows(app).then(r => r.length)).toBe(0)
})

test('under a text scale the menu is anchored where the select is drawn', async () => {
  await app.evaluate(() => (globalThis as any).__obsrv.target.setTextScale(1.5))
  await expect.poll(() => inTarget<number>('devicePixelRatio')).toBe(1.5)
  // The page's CSS px are 1.5 surface px now: the click goes where the
  // select is drawn, and Chromium maps it back through the emulation.
  const r = await inTarget<{ x: number; y: number }>(
    `(() => { const r = document.getElementById('sel').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`,
  )
  const sel = await canvasPoint(r.x * 1.5, r.y * 1.5)
  await page.mouse.click(sel.x, sel.y)
  await waitForMenu(app)
  const menu = await app.evaluate(() =>
    (globalThis as any).__obsrv.overlay.webContents.executeJavaScript(
      `(() => { const r = document.querySelector('.select-menu').getBoundingClientRect(); return { x: r.x, y: r.y } })()`,
    ),
  )
  // The menu opens under the select: its top is at or below the select's box on the canvas.
  const box = await inTarget<{ x: number; y: number; height: number }>(
    `(() => { const r = document.getElementById('sel').getBoundingClientRect(); return { x: r.x, y: r.y, height: r.height } })()`,
  )
  const anchorTop = await canvasPoint(box.x * 1.5, (box.y + box.height) * 1.5)
  const canvasBox = (await page.locator('.target-canvas').boundingBox())!
  expect(menu.y).toBeGreaterThanOrEqual(anchorTop.y - 2)
  expect(menu.x).toBeGreaterThanOrEqual(canvasBox.x - 2)
  await menuKey(app, 'Escape')
  await app.evaluate(() => (globalThis as any).__obsrv.target.setTextScale(1))
})

// --- date, time and colour pickers (shared/pickerPopup.ts) -------------------
// Chromium's picker is a widget outside the page and cannot be reached from a
// test any more than from an offscreen window; what is checked is the host
// input the overlay lays over the page's, that main's click landed on it, and
// that what the host takes reaches the page with the events a real pick fires.

test('clicking a date input hosts a picker input over it in the overlay; a pick lands in the page with input and change', async () => {
  const date = await centreOf('date')
  await page.mouse.click(date.x, date.y)
  const host = await waitForPicker(app)
  expect(host.type).toBe('date')
  expect(host.value).toBe('2026-09-02')
  expect(host.min).toBe('2026-01-01')
  expect(host.max).toBe('2026-12-31')
  // Laid over the input's box on the canvas.
  const box = await inTarget<{ x: number; y: number }>(
    `(() => { const r = document.getElementById('date').getBoundingClientRect(); return { x: r.x, y: r.y } })()`,
  )
  const corner = await canvasPoint(box.x, box.y)
  expect(Math.abs(host.x - corner.x)).toBeLessThan(3)
  expect(Math.abs(host.y - corner.y)).toBeLessThan(3)
  // Main's click landed and carried a gesture: the host holds focus and
  // Chromium showed its calendar for `showPicker()` (it throws otherwise).
  await expect.poll(() => pickerHost(app).then(h => h?.focused ?? false)).toBe(true)
  await expect.poll(() => pickerHost(app).then(h => h?.shown ?? '')).toBe('ok')

  await setPickerValue(app, '2026-10-05', true)
  await expect.poll(() => inTarget<string>("document.getElementById('date').value")).toBe('2026-10-05')
  const log = await pageLog()
  expect(log).toContain('mousedown:date')
  expect(log).toContain('input:date')
  expect(log).toContain('change:date')
  await expect.poll(() => pickerHost(app)).toBeNull()
  await expect(page.locator('.target-canvas')).toBeFocused()
})

test('a colour input streams its values live and commits once', async () => {
  const before = (await pageLog()).length
  const c = await centreOf('color')
  await page.mouse.click(c.x, c.y)
  const host = await waitForPicker(app)
  expect(host.type).toBe('color')
  expect(host.value).toBe('#336699')
  await expect.poll(() => pickerHost(app).then(h => h?.shown ?? '')).toBe('ok')
  await setPickerValue(app, '#ff0000', false)
  await expect.poll(() => inTarget<string>("document.getElementById('color').value")).toBe('#ff0000')
  // Still up while the picker is being dragged.
  expect(await pickerHost(app)).not.toBeNull()
  await setPickerValue(app, '#00ff00', true)
  await expect.poll(() => inTarget<string>("document.getElementById('color').value")).toBe('#00ff00')
  const log = (await pageLog()).slice(before)
  expect(log.filter(l => l === 'input:color')).toHaveLength(2)
  expect(log.filter(l => l === 'change:color')).toHaveLength(1)
  await expect.poll(() => pickerHost(app)).toBeNull()
})

test('Escape dismisses a picker without a change', async () => {
  const before = (await pageLog()).length
  const date = await centreOf('date')
  await page.mouse.click(date.x, date.y)
  await waitForPicker(app)
  await menuKey(app, 'Escape')
  await expect.poll(() => pickerHost(app)).toBeNull()
  expect(await inTarget<string>("document.getElementById('date').value")).toBe('2026-10-05')
  expect((await pageLog()).slice(before).filter(l => l.startsWith('change'))).toEqual([])
  await expect(page.locator('.target-canvas')).toBeFocused()
})

test('a menu opening puts a hosted picker away', async () => {
  const date = await centreOf('date')
  await page.mouse.click(date.x, date.y)
  await waitForPicker(app)
  await page.locator('.preset-select').click()
  await waitForMenu(app)
  expect(await pickerHost(app)).toBeNull()
  await menuKey(app, 'Escape')
  await expect.poll(() => menuRows(app).then(r => r.length)).toBe(0)
})
