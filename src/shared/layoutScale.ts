/**
 * How much smaller a page is drawn than it is laid out.
 *
 * A page with no `<meta name="viewport">` under a phone preset is laid out at
 * Chromium's fallback width — 980 CSS px — and scaled to fit the screen, so
 * berkshirehathaway.com on a 360 px preset is drawn at 360/980 of its own
 * coordinates. Every length the page reports is in those coordinates: a 16 px
 * font measures 16 and is drawn at 5.9, and the audit called it 3.0 mm on a
 * phone where it is 1.1. Millimetres and device pixels are lengths on the
 * glass, so they take the page's length times this scale. The page's own
 * coordinates — rects, font sizes, page height — are left as they are: that
 * is what a highlight in page space and the scroller itself work in, and they
 * agree with each other.
 *
 * The screen's CSS width is what the target was set to; under a text scale
 * the page is laid out in 1/textScale of it, so that is the width a page that
 * fits reports as its layout viewport. 1 whenever the two agree — a viewport
 * meta tag, or any desktop preset — so the ordinary case is untouched. A
 * layout viewport *narrower* than the screen (`initial-scale` above 1) is
 * drawn magnified, and the scale says so in the other direction.
 */

/** Rounding in either width (a fractional CSS viewport under a text scale) is not a scale. */
const LAYOUT_SCALE_SLACK = 0.01

export function layoutScale(screenCssWidth: number, textScale: number, layoutViewportWidth: number): number {
  if (!(screenCssWidth > 0) || !(layoutViewportWidth > 0)) return 1
  const expected = screenCssWidth / (textScale > 0 ? textScale : 1)
  const scale = expected / layoutViewportWidth
  if (!Number.isFinite(scale) || scale <= 0) return 1
  if (Math.abs(scale - 1) < LAYOUT_SCALE_SLACK) return 1
  return scale
}

/**
 * What to tell the caller when the scale is not 1: what the page did, and
 * which figures are in which units. Null at 1, so nothing is said in the
 * ordinary case.
 */
export function layoutScaleNote(scale: number, layoutViewportWidth: number, expectedLayoutWidth: number): string | null {
  if (scale === 1) return null
  const given = Math.round(expectedLayoutWidth)
  const laid = Math.round(layoutViewportWidth)
  const where = `the page lays out ${laid} CSS px wide where the screen gives it ${given}`
  const units = `the millimetres and device pixels here are of the page as drawn, and its rects, font sizes and pageHeight are in its own layout px`
  if (scale < 1) {
    return (
      `${where} and is drawn at ${scale.toFixed(2)}× to fit — what a page with no viewport meta tag does — so its own px are ` +
      `${(1 / scale).toFixed(2)}× larger than they are on the glass; ${units}`
    )
  }
  return `${where} and is drawn at ${scale.toFixed(2)}× (an initial-scale above 1), so its own px are that much larger on the glass than they read; ${units}`
}
