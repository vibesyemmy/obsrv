/**
 * Pure view-mode maths for the target pane: the fit-overview magnification
 * and the scroll offsets for the fit→1:1 jump. No DOM, no GL — tests in node.
 */

function usable(...ns: number[]): boolean {
  return ns.every(n => Number.isFinite(n) && n > 0)
}

/**
 * Host pixels per target pixel that shows the whole `vpW`×`vpH` viewport
 * inside a `paneW`×`paneH` CSS-pixel pane: the smaller axis ratio, never
 * enlarged past `oneToOneScale` — fit is an overview, not a zoom. Falls back
 * to 1 when any input is non-finite or non-positive (a zero-sized pane
 * mid-layout, a half-initialised viewport).
 */
export function computeFitScale(
  paneW: number,
  paneH: number,
  dpr: number,
  vpW: number,
  vpH: number,
  oneToOneScale: number,
): number {
  if (!usable(paneW, paneH, dpr, vpW, vpH, oneToOneScale)) return 1
  return Math.min((paneW * dpr) / vpW, (paneH * dpr) / vpH, oneToOneScale)
}

/**
 * Scroll offsets (CSS px) that centre the clicked target pixel in the pane
 * after the fit→1:1 switch. `clickX`/`clickY` are canvas-relative CSS pixels
 * in fit mode; the target pixel under them is `click × dpr / fitScale`, and
 * at 1:1 that pixel sits `target × oneToOneScale / dpr` CSS pixels from the
 * canvas origin. Each axis clamps to the scrollable range
 * `[0, vp × S / dpr − pane]` — zero when the 1:1 canvas is smaller than the
 * pane. Bad inputs (non-finite, non-positive scales or sizes) yield the
 * origin rather than NaN scroll positions.
 */
export function jumpScroll(
  clickX: number,
  clickY: number,
  dpr: number,
  fitScale: number,
  oneToOneScale: number,
  paneW: number,
  paneH: number,
  vpW: number,
  vpH: number,
): { left: number; top: number } {
  if (
    !usable(dpr, fitScale, oneToOneScale, paneW, paneH, vpW, vpH) ||
    !Number.isFinite(clickX) ||
    !Number.isFinite(clickY)
  ) {
    return { left: 0, top: 0 }
  }
  const axis = (click: number, pane: number, vp: number): number => {
    const target = (click * dpr) / fitScale
    const want = (target * oneToOneScale) / dpr - pane / 2
    const max = (vp * oneToOneScale) / dpr - pane
    return Math.min(Math.max(want, 0), Math.max(max, 0))
  }
  return { left: axis(clickX, paneW, vpW), top: axis(clickY, paneH, vpH) }
}
