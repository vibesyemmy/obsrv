import type { ElectronApplication } from '@playwright/test'

/**
 * Whether this desk's captures come back at the host display's scale rather
 * than the window's own pixels. `webContents.capturePage()` returns a bitmap at
 * the *main display's* scale factor whatever the target's density — 2× on a
 * built-in Retina Mac, 1× on an external 1080p monitor — so a spec that reads
 * an absolute capture size, or a pixel at a computed centre, passes on one desk
 * and fails on another with nothing in the tree changed (docs/e2e-flakes.md).
 *
 * Measured rather than inferred from the display list: the probe captures the
 * real window and divides by the size that window says it is, which is the same
 * arithmetic the failing assertions do. A machine that stops doing this stops
 * skipping, without anyone editing a list of hosts.
 *
 * Never skips on CI, where the runner's display does not move and a failure is
 * still the signal.
 */
export function captureScaleReason(scale: number): string {
  return `this desk captures at ${scale}× the window: capturePage returns the main display's pixels, not the window's (docs/e2e-flakes.md)`
}

/** The ratio between a window capture's width and the window's own width. 1 on a 1× desk. */
export async function captureScale(app: ElectronApplication): Promise<number> {
  return app.evaluate(async () => {
    const win = (globalThis as any).__obsrv.win
    const [width] = win.getContentSize() as [number, number]
    const shot = await win.webContents.capturePage()
    return shot.getSize().width / width
  })
}

/** Skip only where the capture is scaled, and never on CI. */
export function skipWhenCapturesAreScaled(scale: number): boolean {
  return scale > 1 && !process.env['CI']
}
