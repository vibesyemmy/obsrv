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
    await sayWhyItStalled(page, open)
    throw e
  }
}

/**
 * Two samples, a second apart, on the way out of a failed drawer wait.
 *
 * **What this exists for.** `bug-drawer-stalls-part-open`: twice on CI this poll
 * gave up with the drawer about 7% open — `18.8536px` and `22.1934px` against the
 * `309px` it wanted — and the card's question is the one thing every candidate fix
 * depends on and the one thing the failure could not say: **is the renderer
 * starved and would it have finished, or is it stuck?** A poll that reports only
 * its last value cannot tell those apart, so three weeks of sightings produced
 * five dead hypotheses and no answer.
 *
 * **Two samples answer it.** If the width advances between them the transition is
 * merely slow and would have landed; if it is identical and `rAF` did not fire,
 * the renderer is not servicing frames at all. That is the whole discriminator.
 *
 * **Why two and not a thirty-second watch**, which is what I ran on a probe branch
 * and would rather have here: this helper is shared with specs that have the
 * default 30 s budget, and a long poll inside one is exactly the 0.32.0 defect in
 * `docs/e2e-flakes.md:141` — the poll outlived its test, rejected with no test to
 * belong to, and turned a green suite red. Roughly 1.3 s on a path that has
 * already spent 5 s failing is affordable anywhere.
 *
 * It also records whether the *state* landed. A third shape appeared later —
 * `0px`, a transition that never started (`text-scale.spec.ts:194`) — and
 * `aria-pressed`/`data-drawer` separate "the click never registered" from "the
 * transition never got its first frame", which are different bugs with the same
 * timeout.
 *
 * Diagnostics only: it changes no assertion, and it runs only when one has
 * already failed.
 */
async function sayWhyItStalled(page: Page, open: boolean): Promise<void> {
  const sample = (): Promise<string> =>
    page
      .evaluate(async () => {
        const app = document.querySelector('.app')
        if (app === null) return 'no .app element'
        const width = getComputedStyle(app).getPropertyValue('--drawer-w').trim()
        const drawer = app.getAttribute('data-drawer') ?? 'none'
        const pressed = document.querySelector('.toggle-panel')?.getAttribute('aria-pressed') ?? 'none'
        // Liveness, not timing: a document whose frames are not being serviced
        // never calls back at all.
        const raf = await new Promise<string>(resolve => {
          const timer = setTimeout(() => resolve('rAF-dead'), 250)
          requestAnimationFrame(() => {
            clearTimeout(timer)
            resolve('rAF-ok')
          })
        })
        return `${width} drawer=${drawer} pressed=${pressed} ${document.visibilityState} ${raf}`
      })
      .catch(err => `unreadable (${String(err).slice(0, 40)})`)

  const first = await sample()
  await new Promise(r => setTimeout(r, 1_000))
  const second = await sample()
  const verdict =
    first === second ? 'UNCHANGED over 1 s — not merely slow' : 'ADVANCED over 1 s — slow, would likely have landed'
  // One line, greppable, naming its card so whoever meets it knows what it is.
  console.log(`DRAWER STALL (bug-drawer-stalls-part-open) wanted=${open ? '309px' : '0px'} | ${first} | +1s: ${second} | ${verdict}`)
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
