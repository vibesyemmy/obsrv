import { expect, type ElectronApplication } from '@playwright/test'

/**
 * The picker host is drawn by the overlay view, like the menus (see
 * ./select.ts): an invisible `<input>` of the target input's type over its
 * box on the canvas, which Chromium's own picker hangs on. Playwright has no
 * page for the overlay, so these go through main.
 */

function inOverlay<T>(app: ElectronApplication, expression: string): Promise<T> {
  return app.evaluate(
    ({}, source: string) =>
      (globalThis as any).__obsrv.overlay.webContents.executeJavaScript(source) as Promise<T>,
    expression,
  )
}

export interface HostedPicker {
  type: string
  value: string
  min: string
  max: string
  step: string
  ariaLabel: string
  focused: boolean
  /** `ok` once Chromium showed its picker for main's click; otherwise the error name, or '' before the click. */
  shown: string
  x: number
  y: number
  width: number
  height: number
}

/** The hosted input, or null while none is up. */
export function pickerHost(app: ElectronApplication): Promise<HostedPicker | null> {
  return inOverlay(app, `(() => {
    const el = document.querySelector('input.picker-host')
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { type: el.type, value: el.value, min: el.min, max: el.max, step: el.step, ariaLabel: el.getAttribute('aria-label') ?? '',
      focused: document.activeElement === el, shown: el.dataset.shown ?? '', x: r.x, y: r.y, width: r.width, height: r.height }
  })()`)
}

export async function waitForPicker(app: ElectronApplication): Promise<HostedPicker> {
  await expect.poll(() => pickerHost(app)).not.toBeNull()
  return (await pickerHost(app))!
}

/**
 * What Chromium's picker does when the user picks: sets the value and fires
 * `input`, then `change` when `commit` is set. The picker itself is a widget
 * outside the page, so the test speaks to the input it drives.
 */
export async function setPickerValue(app: ElectronApplication, value: string, commit: boolean): Promise<void> {
  const ok = await inOverlay<boolean>(
    app,
    `(() => {
      const el = document.querySelector('input.picker-host')
      if (!el) return false
      el.value = ${JSON.stringify(value)}
      el.dispatchEvent(new Event('input', { bubbles: true }))
      if (${commit}) el.dispatchEvent(new Event('change', { bubbles: true }))
      return true
    })()`,
  )
  expect(ok, 'no picker host to set').toBe(true)
}
