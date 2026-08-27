import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { launchApp, openOverflow, rendererWindow } from './launch'

/** The 5000px-spacer fixture sync.spec.ts scrolls; its height is fixed so both
 *  panes reach the same offset whatever their widths. */
const TALL = pathToFileURL(resolve(__dirname, '../fixtures/tall.html')).href

let app: ElectronApplication
let page: Page

/** Asks main whether the native WebContentsView is currently on screen. */
const nativeVisible = () =>
  app.evaluate(() => (globalThis as any).__obsrv.native.isVisible() as boolean)

test.beforeAll(async () => {
  app = await launchApp()
  page = await rendererWindow(app)
})
test.afterAll(async () => {
  await app.close()
})

test('setNativeVisible hides and restores the OS-level view', async () => {
  expect(await nativeVisible()).toBe(true)

  await page.evaluate(() => (window as any).obsrv.setNativeVisible(false))
  await expect.poll(nativeVisible).toBe(false)

  await page.evaluate(() => (window as any).obsrv.setNativeVisible(true))
  await expect.poll(nativeVisible).toBe(true)
})

test('image mode and panes do not clobber each other', async () => {
  // Hidden by panes, then image mode ends: still hidden, because panes says so.
  await page.evaluate(() => (window as any).obsrv.setNativeVisible(false))
  await page.evaluate(() => (window as any).obsrv.setMode('image'))
  await expect.poll(nativeVisible).toBe(false)

  await page.evaluate(() => (window as any).obsrv.setMode('url'))
  await expect.poll(nativeVisible).toBe(false)

  await page.evaluate(() => (window as any).obsrv.setNativeVisible(true))
  await expect.poll(nativeVisible).toBe(true)
})

test('the target pane takes the whole window and gives it back', async () => {
  const paneWidth = () =>
    page.evaluate(() => (document.querySelector('.target-pane') as HTMLElement).getBoundingClientRect().width)
  const shared = await paneWidth()

  await page.click('.panes-target')
  await expect(page.locator('.native-slot')).toHaveCount(0)
  await expect.poll(nativeVisible).toBe(false)
  await expect.poll(paneWidth).toBeGreaterThan(shared * 1.8)

  await page.click('.panes-both')
  await expect(page.locator('.native-slot')).toHaveCount(1)
  await expect.poll(nativeVisible).toBe(true)
  await expect.poll(paneWidth).toBeLessThan(shared * 1.2)
})

test('the native view is repositioned before it is shown again', async () => {
  await page.click('.panes-target')
  await expect.poll(nativeVisible).toBe(false)

  // The layout has to change while the slot is unmounted, or this test cannot
  // fail: with the row the same width on the way back, the stale rectangle and
  // the fresh one are the same rectangle and the assertion below is vacuous.
  // The drawer narrows the row, so a view that was never repositioned keeps its
  // wider solo-era bounds and is caught.
  // NOTE(task-9): `.toggle-panel` now lives in the overflow menu, so the click
  // is reached through `openOverflow` — it is load-bearing, not clutter, and it
  // still narrows the row exactly as before.
  await openOverflow(page)
  await page.click('.overflow-menu .toggle-panel')

  await page.click('.panes-both')
  await expect.poll(nativeVisible).toBe(true)

  const [slot, view] = await Promise.all([
    page.evaluate(() => {
      const r = (document.querySelector('.native-slot') as HTMLElement).getBoundingClientRect()
      return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width) }
    }),
    app.evaluate(() => (globalThis as any).__obsrv.native.getBounds()),
  ])
  expect(view.width).toBe(slot.width)
  expect(view.x).toBe(slot.x)
  expect(view.y).toBe(slot.y)

  // Leave the drawer as it was found, for whatever runs after this.
  await openOverflow(page)
  await page.click('.overflow-menu .toggle-panel')
})

/**
 * `window.scrollY` of a pane's page, read straight from its webContents —
 * the readout sync.spec.ts uses. It goes through the debugger rather than
 * the page's own render loop, so it reports honestly on a view that is off
 * screen, which is the whole point here.
 */
const paneScrollY = (pane: 'native' | 'target'): Promise<number> =>
  app.evaluate(
    (_electron, p: string) =>
      (globalThis as any).__obsrv[p].webContents.executeJavaScript('window.scrollY') as Promise<number>,
    pane,
  )

/** How tall a pane's document is: the gate that says the tall fixture has laid
 *  out, so the scroll below cannot clamp to 0 against a page still at 0px. */
const paneScrollHeight = (pane: 'native' | 'target'): Promise<number> =>
  app.evaluate(
    (_electron, p: string) =>
      (globalThis as any).__obsrv[p].webContents.executeJavaScript(
        'document.documentElement.scrollHeight',
      ) as Promise<number>,
    pane,
  )

test('a scroll in solo target still reaches the hidden native pane', async () => {
  await page.evaluate(u => window.obsrv.navigate(u), TALL)
  await expect
    .poll(
      () =>
        app.evaluate(() => {
          const ctx = (globalThis as any).__obsrv
          return { native: ctx.native.webContents.getURL(), target: ctx.target.webContents.getURL() }
        }),
      { timeout: 10_000 },
    )
    .toEqual({ native: TALL, target: TALL })
  // Both documents must be the full 5000px before anything is scrolled: a
  // `scrollTo` against a page that has not laid out yet clamps to 0 silently,
  // and the assertion below would then be measuring the wrong failure.
  await expect.poll(() => paneScrollHeight('target'), { timeout: 10_000 }).toBeGreaterThan(4_000)
  await expect.poll(() => paneScrollHeight('native'), { timeout: 10_000 }).toBeGreaterThan(4_000)

  await page.click('.panes-target')
  await expect.poll(nativeVisible).toBe(false)

  // Scroll the target pane — the only pane the user can see or touch now. The
  // native pane is reached solely by SyncBus mirroring this move to it; nothing
  // else writes an offset into it.
  await app.evaluate(() =>
    (globalThis as any).__obsrv.target.webContents.executeJavaScript('window.scrollTo(0, 1600)'),
  )
  await expect.poll(() => paneScrollY('target'), { timeout: 5_000 }).toBe(1600)

  // The hidden native pane must have followed. If this fails, the view is being
  // background-throttled and solo target is quietly lying about where the page
  // is — the native pane is still the navigation master.
  await expect
    .poll(() => paneScrollY('native'), {
      timeout: 5_000,
      message: 'the hidden native pane should have been scrolled to 1600 by the sync bus',
    })
    .toBe(1600)

  // Leave the app as this spec found it, for anything that runs after.
  await page.click('.panes-both')
  await expect.poll(nativeVisible).toBe(true)
})

// A render smaller than the pane used to hug the top-left corner, stranded
// against the chrome with dead field to the right. `safe center` must still
// fall back to start alignment when the render overflows, or the top-left of
// an oversized one becomes unreachable by scrolling — so both are asserted.
test('a render smaller than the pane is centred, an oversized one is not', async () => {
  await page.click('.panes-target')

  const gaps = async () =>
    page.evaluate(() => {
      const body = document.querySelector('.target-pane .pane-body') as HTMLElement
      const canvas = document.querySelector('.target-pane canvas') as HTMLElement
      const b = body.getBoundingClientRect()
      const c = canvas.getBoundingClientRect()
      return {
        left: Math.round(c.x - b.x),
        right: Math.round(b.right - c.right),
        top: Math.round(c.y - b.y),
        bottom: Math.round(b.bottom - c.bottom),
      }
    })

  await page.selectOption('.preset-select', 'android-65')
  await expect.poll(async () => (await gaps()).left, { timeout: 5000 }).toBeGreaterThan(0)
  const small = await gaps()
  expect(Math.abs(small.left - small.right)).toBeLessThanOrEqual(1)
  expect(Math.abs(small.top - small.bottom)).toBeLessThanOrEqual(1)

  // Wider than the pane: start-aligned, so scrolling still reaches its origin.
  await page.selectOption('.preset-select', 'laptop-768')
  await expect.poll(async () => (await gaps()).right, { timeout: 5000 }).toBeLessThan(0)
  expect((await gaps()).left).toBe(0)

  await page.click('.panes-both')
})
