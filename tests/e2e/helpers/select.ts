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
