import type { ElectronApplication } from '@playwright/test'

/**
 * Whether this desk lets the app's window hide *as an event*. On macOS
 * Electron derives a window's `hide` and `show` from its occlusion state, and
 * some desk state (measured, never named — see docs/e2e-flakes.md) keeps the
 * window from ever counting as visible: `win.hide()` and `win.show()` flip
 * `isVisible()` and fire nothing. Every test that starts by hiding the window
 * then fails with no code involved. Those tests probe once and skip with the
 * reason instead — off CI only, where the failure is still the signal.
 */
export const DESK_STATE_REASON =
  'this desk fires no hide event for win.hide(): macOS occlusion state, not code (docs/e2e-flakes.md)'

/** True when a `hide` event follows `win.hide()`. Leaves the window shown. */
export async function hideEventsFire(app: ElectronApplication): Promise<boolean> {
  return app.evaluate(async () => {
    const win = (globalThis as any).__obsrv.win
    const fired = new Promise<boolean>(resolve => {
      const onHide = (): void => {
        clearTimeout(timer)
        resolve(true)
      }
      const timer = setTimeout(() => {
        win.off('hide', onHide)
        resolve(false)
      }, 1500)
      win.once('hide', onHide)
    })
    win.hide()
    const ok = await fired
    win.show()
    // Let the show land, so the tests start from a visible, painting window.
    await new Promise(r => setTimeout(r, 300))
    return ok
  })
}

/** Skip unless the desk delivers hide events; on CI never skip, so the failure stays visible there. */
export function skipWithoutHideEvents(hideEvents: boolean): boolean {
  return !hideEvents && !process.env['CI']
}
