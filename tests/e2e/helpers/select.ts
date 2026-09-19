import { expect, type ElectronApplication, type Page } from '@playwright/test'

/**
 * Menus are not in the renderer Playwright is attached to.
 *
 * They are drawn by the overlay `WebContentsView` (`src/main/overlay.ts`),
 * because the native pane is composited above the window's DOM and a menu in
 * the chrome would open underneath it. A `WebContentsView` is not a window, so
 * Playwright exposes no page for it — these go through main, the same way specs
 * already reach the native pane.
 */

/** Runs an expression inside the overlay's page and returns its value. */
function inOverlay<T>(app: ElectronApplication, expression: string): Promise<T> {
  return app.evaluate(
    ({}, source: string) =>
      (globalThis as any).__obsrv.overlay.webContents.executeJavaScript(source) as Promise<T>,
    expression,
  )
}

/** Every row currently drawn, in order. Empty when no menu is open. */
export function menuRows(app: ElectronApplication): Promise<string[]> {
  return inOverlay(app, `Array.from(document.querySelectorAll('.select-option'))
    .map(el => el.dataset.value)`)
}

/** The menu's rectangle in window coordinates, or null when none is open. */
export function menuBox(
  app: ElectronApplication,
): Promise<{ x: number; y: number; width: number; height: number } | null> {
  return inOverlay(app, `(() => {
    const el = document.querySelector('.select-menu')
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: r.x, y: r.y, width: r.width, height: r.height }
  })()`)
}

/** Whether the menu has more rows than it can show, i.e. it is clamped. */
export function menuScrolls(app: ElectronApplication): Promise<boolean> {
  return inOverlay(app, `(() => {
    const el = document.querySelector('.select-menu')
    return !!el && el.scrollHeight > el.clientHeight
  })()`)
}

/** The value on the ticked row. */
export function menuTicked(app: ElectronApplication): Promise<string | null> {
  return inOverlay(app, `document.querySelector('.select-option[aria-selected="true"]')?.dataset.value ?? null`)
}

/** The row the keyboard is on. */
export function menuActive(app: ElectronApplication): Promise<string | null> {
  return inOverlay(app, `document.querySelector('.select-option.active')?.textContent?.trim() ?? null`)
}

/** Waits for a menu to be on screen — opening crosses two processes. */
export async function waitForMenu(app: ElectronApplication): Promise<void> {
  await expect.poll(() => menuRows(app).then(r => r.length)).toBeGreaterThan(0)
}

/**
 * Clicks a row. `mousedown` rather than `click`: that is what the menu commits
 * on, so that a press landing outside can dismiss before a click would arrive.
 */
export async function pickMenu(app: ElectronApplication, value: string): Promise<void> {
  await waitForMenu(app)
  const hit = await inOverlay<boolean>(
    app,
    `(() => {
      const el = document.querySelector('.select-option[data-value=' + ${JSON.stringify(JSON.stringify(value))} + ']')
      if (!el) return false
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
      return true
    })()`,
  )
  expect(hit, `no menu row for ${value}`).toBe(true)
}

/** Presses a key at the menu, which holds focus while it is open. */
export async function menuKey(app: ElectronApplication, key: string): Promise<void> {
  await app.evaluate(({}, k: string) => {
    const wc = (globalThis as any).__obsrv.overlay.webContents
    wc.sendInputEvent({ type: 'keyDown', keyCode: k })
    wc.sendInputEvent({ type: 'char', keyCode: k })
    wc.sendInputEvent({ type: 'keyUp', keyCode: k })
  }, key)
}

/**
 * Opens the side panel (the drawer text scale, throttle, the onion skin, the
 * panel sliders and vision live in) if it is closed. Idempotent.
 */
export async function openPanel(page: Page): Promise<void> {
  const toggle = page.locator('.toggle-panel')
  if ((await toggle.getAttribute('aria-pressed')) !== 'true') await toggle.click()
  await expect(page.locator('.drawer')).toBeVisible()
  await drawerSettled(page, true)
}

/** The drawer slides; a spec that measures the panes waits for the width to land. */
export async function drawerSettled(page: Page, open: boolean): Promise<void> {
  // The transition is 220 ms; five seconds is generous. Ten was enough for a
  // poll to outlive a test that relaunches the app on a loaded runner, and a
  // poll rejecting after its test ended is "1 error was not a part of any
  // test" — a red run with every test green (0.32.0 tag job).
  try {
    await expect
      .poll(() => page.evaluate(() => getComputedStyle(document.querySelector('.app')!).getPropertyValue('--drawer-w').trim()), { timeout: 5_000 })
      .toBe(open ? '309px' : '0px')
  } catch (e) {
    await watchTheStall(page, open, e)
    throw e
  }
}

/**
 * PROBE ONLY (`probe/drawer-stall`, `bug-drawer-stalls-part-open`). Not for main.
 *
 * **Here rather than on one call site, because my first version watched the
 * wrong one.** I put it on `openPanel(p1)` in `text-scale.spec.ts`'s relaunch
 * test, and the next failure was `:194` — eight lines away, on the file's shared
 * app, where nothing was watching. Every drawer wait in the suite goes through
 * this function, so this is the only place that cannot miss a sighting.
 *
 * **It records whether the renderer is ALIVE and whether the STATE landed**, not
 * only what the width is, because two different shapes have now been seen and
 * the width alone cannot tell them apart:
 *
 *   ~18-22px  a transition that painted one frame and stopped   (the carded bug)
 *   0px       a transition that never started at all            (`:194`)
 *
 * `aria-pressed` and `data-drawer` are the discriminator for the second. If the
 * state landed and the width is still `0px`, the transition never got its first
 * frame — the same story one frame earlier, and the two shapes are one bug. If
 * the state never landed, the click or its IPC failed and transitions are
 * irrelevant. `openPanel` only clicks when `aria-pressed !== 'true'`, so a
 * desynced toggle would skip the click and wait five seconds on a drawer nobody
 * asked to open.
 */
async function watchTheStall(page: Page, open: boolean, cause: unknown): Promise<void> {
  const want = open ? '309px' : '0px'
  const t0 = Date.now()
  const seen: string[] = []
  for (let i = 0; i < 60; i++) {
    const sample = await page
      .evaluate(async () => {
        const app = document.querySelector('.app')!
        const w = getComputedStyle(app).getPropertyValue('--drawer-w').trim()
        const state = app.getAttribute('data-drawer') ?? 'none'
        const pressed = document.querySelector('.toggle-panel')?.getAttribute('aria-pressed') ?? 'none'
        // A hidden or throttled document never calls back: liveness, not timing.
        const raf = await new Promise<string>(resolve => {
          const timer = setTimeout(() => resolve('rafDEAD'), 250)
          requestAnimationFrame(() => {
            clearTimeout(timer)
            resolve('rafOK')
          })
        })
        return `${w} drawer=${state} pressed=${pressed} ${document.visibilityState} ${raf}`
      })
      .catch(err => `ERR ${String(err).slice(0, 30)}`)
    seen.push(`${Date.now() - t0}ms=[${sample}]`)
    if (sample.startsWith(`${want} `)) break
    await new Promise(r => setTimeout(r, 500))
  }
  console.log(`DRAWER STALL PROBE | wanted=${want} | ${String(cause).slice(0, 60)} | ${seen.join(' ')}`)
}

/**
 * Picks a value from one of the app's menus: opens it from the trigger, clicks
 * the row, and waits for the choice to reach the chrome.
 *
 * The trigger carries `data-value`, and this waits for it — the choice travels
 * overlay → main → chrome → React state, and a caller reading the viewport
 * straight afterwards would race the re-render.
 */
export async function choose(
  app: ElectronApplication,
  page: Page,
  trigger: string,
  value: string,
): Promise<void> {
  await page.locator(trigger).click()
  await pickMenu(app, value)
  await expect(page.locator(trigger)).toHaveAttribute('data-value', value)
}
