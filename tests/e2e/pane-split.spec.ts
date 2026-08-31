import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { launchApp, rendererWindow } from './launch'

/**
 * The draggable seam (spec `2026-08-28-obsrv-pane-split.md`).
 *
 * Widths, not the stored ratio, are what these assert: the ratio is only
 * evidence of intent, and the whole point of the feature is where the panes
 * actually end up. The stored value's own clamping is a unit concern
 * (`tests/unit/settings.test.ts`) — `launchApp` mkdtemps a fresh user-data
 * dir per launch, so an e2e could not prove persistence anyway.
 */

let app: ElectronApplication
let page: Page

/** Wide enough that a 300px drag stays clear of the 240px floor at both ends. */
const WIN = { width: 1600, height: 1000 }

test.beforeAll(async () => {
  app = await launchApp()
  page = await rendererWindow(app)
  await app.evaluate(({ BrowserWindow }, size) => {
    BrowserWindow.getAllWindows()[0]!.setContentSize(size.width, size.height)
  }, WIN)
  await expect.poll(async () => (await geometry()).row.width).toBe(WIN.width)
})
test.afterAll(async () => {
  await app.close()
})

// Every test here drags the seam, and the split is persisted — so without a
// reset each one starts from wherever the last left it, and assertions
// computed from the row's edges land somewhere else entirely. Two tests in
// this file failed on different runs for exactly that reason before this
// existed, which is the signature of order dependence rather than a bug in
// what they assert.
// Reset through the divider's own double-click rather than `setSettings`:
// main never pushes settings back to the renderer, so writing the file leaves
// the store — and therefore the layout — untouched. The renderer is normally
// the only writer, so that is not a product bug, but it makes an IPC write a
// useless reset here.
test.beforeEach(async () => {
  // Belt and braces against the same hazard: whatever the previous test did,
  // this one starts with the button up.
  await page.mouse.up()
  await page.dblclick('.pane-divider')
  await expect
    .poll(async () => {
      const g = await geometry()
      return Math.abs(g.nativeW - g.targetW) <= 2
    })
    .toBe(true)
})

/** Everything a drag assertion needs, measured from the live layout. */
const geometry = () =>
  page.evaluate(() => {
    const rect = (sel: string): DOMRect => document.querySelector(sel)!.getBoundingClientRect()
    const row = rect('.panes')
    const seam = rect('.pane-divider')
    const native = rect('.panes > .pane:first-child')
    const target = rect('.target-pane')
    return {
      row: { left: row.left, width: row.width },
      // Where the hairline sits, which is what the pointer is dragging.
      seamX: seam.left + seam.width / 2,
      seamY: row.top + row.height / 2,
      nativeW: native.width,
      targetW: target.width,
    }
  })

/** Drags the seam to an absolute window x, in steps, and releases. */
async function dragSeamTo(x: number): Promise<void> {
  const g = await geometry()
  await page.mouse.move(g.seamX, g.seamY)
  await page.mouse.down()
  try {
    const steps = 12
    for (let i = 1; i <= steps; i++) {
      await page.mouse.move(g.seamX + ((x - g.seamX) * i) / steps, g.seamY)
    }
  } finally {
    // Unconditionally: a move that throws — or a test that times out partway
    // through the drag — would otherwise leave the button held down for the
    // rest of the file, since every test here shares one app. Everything after
    // it then drags when it meant to click, including the retry, which is why
    // such a failure used to survive being retried.
    await page.mouse.up()
  }
  // The drag's last frame and the persist-on-release are both async, so
  // returning here would let the caller measure a seam still in motion. Wait
  // for two identical reads — the same settle-until-stable shape main uses
  // before a capture — rather than a fixed sleep, which would be slower and
  // still occasionally wrong.
  let previous = Number.NaN
  await expect
    .poll(async () => {
      const now = Math.round((await geometry()).seamX)
      const settled = now === previous
      previous = now
      return settled
    })
    .toBe(true)
}

/**
 * The risk the spec names. The pointer travels a long way leftward, over the
 * native pane's territory — an OS-level `WebContentsView` that delivers no
 * events to this document. The assertion is that the seam finished *where the
 * pointer finished*, not merely that it moved: a drag that stalls partway
 * still "changes the split", and a test that only checked for change would
 * pass through exactly the failure this exists to catch.
 */
test('the seam follows the pointer all the way across the native pane', async () => {
  const before = await geometry()
  const travel = 300
  const wanted = before.seamX - travel

  await dragSeamTo(wanted)

  const after = await geometry()
  expect(Math.abs(after.seamX - wanted)).toBeLessThanOrEqual(2)
  // Stated again in the widths, because that is the user-visible outcome:
  // every pixel the pointer travelled came off the native pane and went to
  // the target pane.
  expect(Math.abs(before.nativeW - after.nativeW - travel)).toBeLessThanOrEqual(2)
  expect(Math.abs(after.targetW - before.targetW - travel)).toBeLessThanOrEqual(2)
  // And the row still adds up: the seam took its pixel out of the row, not
  // out of one pane's share.
  expect(after.nativeW + after.targetW).toBeCloseTo(before.row.width - 1, 0)
})

test('the seam drags rightward too, and the native view follows it', async () => {
  const before = await geometry()
  const wanted = before.seamX + 220
  await dragSeamTo(wanted)

  const after = await geometry()
  expect(Math.abs(after.seamX - wanted)).toBeLessThanOrEqual(2)
  expect(Math.abs(after.nativeW - before.nativeW - 220)).toBeLessThanOrEqual(2)

  // The OS-level view is positioned by main from the slot's reported bounds,
  // so a split it did not follow would leave the reference painted over the
  // wrong half of the window.
  const slot = await page.evaluate(() => {
    const r = document.querySelector('.native-slot')!.getBoundingClientRect()
    return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) }
  })
  await expect
    .poll(() => app.evaluate(() => (globalThis as any).__obsrv.native.getBounds()))
    .toEqual(slot)
})

test('neither pane can be dragged below 240px', async () => {
  const row = (await geometry()).row

  // Far past the left edge: the native pane stops at the floor.
  await dragSeamTo(row.left - 400)
  let g = await geometry()
  expect(Math.abs(g.nativeW - 240)).toBeLessThanOrEqual(1)
  expect(g.targetW).toBeGreaterThan(240)

  // And past the right edge: now the target pane is the one at the floor.
  await dragSeamTo(row.left + row.width + 400)
  g = await geometry()
  expect(Math.abs(g.targetW - 240)).toBeLessThanOrEqual(1)
  expect(g.nativeW).toBeGreaterThan(240)
})

test('a double-click on the seam restores 50/50', async () => {
  await dragSeamTo((await geometry()).row.left + 400)
  const uneven = await geometry()
  expect(Math.abs(uneven.nativeW - uneven.targetW)).toBeGreaterThan(200)

  await page.dblclick('.pane-divider')

  await expect.poll(async () => Math.abs((await geometry()).nativeW - (await geometry()).targetW)).toBeLessThanOrEqual(2)
  const even = await geometry()
  expect(Math.abs(even.nativeW - (even.row.width - 1) / 2)).toBeLessThanOrEqual(2)
})

test('arrow keys nudge the split, 2% a press and 10% with Shift', async () => {
  await page.dblclick('.pane-divider')
  await page.locator('.pane-divider').focus()
  await expect(page.locator('.pane-divider')).toBeFocused()

  const start = await geometry()
  const usable = start.row.width - 1

  await page.keyboard.press('ArrowRight')
  await expect
    .poll(async () => Math.abs((await geometry()).nativeW - (start.nativeW + usable * 0.02)))
    .toBeLessThanOrEqual(2)

  await page.keyboard.press('Shift+ArrowLeft')
  await expect
    .poll(async () => Math.abs((await geometry()).nativeW - (start.nativeW - usable * 0.08)))
    .toBeLessThanOrEqual(2)

  // The value the assistive layer reads has to be the value on screen.
  const g = await geometry()
  await expect(page.locator('.pane-divider')).toHaveAttribute(
    'aria-valuenow',
    String(Math.round((g.nativeW / usable) * 100)),
  )
})

test('the separator carries its role and its band', async () => {
  const d = page.locator('.pane-divider')
  await expect(d).toHaveAttribute('role', 'separator')
  await expect(d).toHaveAttribute('aria-orientation', 'vertical')
  await expect(d).toHaveAttribute('aria-valuemin', '10')
  await expect(d).toHaveAttribute('aria-valuemax', '90')
  // A 1px line is not a grab target; the hit area straddles it.
  const box = (await d.boundingBox())!
  expect(box.width).toBeLessThanOrEqual(1.5)
  expect(await d.evaluate(el => getComputedStyle(el).cursor)).toBe('col-resize')
  const hit = await d.evaluate(el => {
    const s = getComputedStyle(el, '::before')
    return { left: s.left, right: s.right }
  })
  expect(hit).toEqual({ left: '-2.5px', right: '-2.5px' })
})

/**
 * The seam used to be `.target-pane`'s own `border-left`, and brightening it
 * was half of how the app shows keyboard focus in the target pane (the pane
 * footer's top rule is the other half). The line has moved to its own
 * element, so the signal has to reach it across the row.
 */
test('keyboard focus in the target pane still brightens the seam', async () => {
  const seamColour = () =>
    page.evaluate(() => getComputedStyle(document.querySelector('.pane-divider')!).backgroundColor)
  const footerColour = () =>
    page.evaluate(() =>
      getComputedStyle(document.querySelector('.target-pane .pane-footer')!).borderTopColor,
    )

  // Park the pointer off the seam: `:hover` brightens it too, and a stale
  // hover would make this pass without any focus at all.
  await page.mouse.move(20, 300)
  await page.locator('.url-form input').focus()
  const restLine = await seamColour()
  const restFooter = await footerColour()

  // Real Tab-walking, not `.focus()`: `:focus-visible` is the selector under
  // test and it only applies to keyboard-driven focus.
  const onCanvas = () =>
    page.evaluate(() => document.activeElement?.classList.contains('target-canvas') === true)
  for (let i = 0; i < 40 && !(await onCanvas()); i++) await page.keyboard.press('Tab')
  expect(await onCanvas()).toBe(true)

  const litLine = await seamColour()
  expect(litLine).not.toBe(restLine)
  expect(await footerColour()).not.toBe(restFooter)
  // Both hairlines land on the same neutral weight, `--text-1`.
  expect(litLine).toBe(await footerColour())

  await page.locator('.url-form input').focus()
  await expect.poll(seamColour).toBe(restLine)
})

test('solo target renders no separator at all', async () => {
  await expect(page.locator('.pane-divider')).toHaveCount(1)
  await page.click('.panes-target')
  await expect(page.locator('.pane-divider')).toHaveCount(0)
  // The target pane takes the whole row, seam included.
  const g = await page.evaluate(() => ({
    row: document.querySelector('.panes')!.getBoundingClientRect().width,
    target: document.querySelector('.target-pane')!.getBoundingClientRect().width,
  }))
  expect(g.target).toBe(g.row)

  await page.click('.panes-both')
  await expect(page.locator('.pane-divider')).toHaveCount(1)
})
