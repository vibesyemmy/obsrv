/**
 * The onion skin: the same page, rendered a second time at a HiDPI
 * density and the same CSS viewport, blended over the target's raster at
 * an opacity the user drags between. What a designer's screen shows over
 * what the target screen shows, in one place — the drift a 1x raster
 * introduces (hinted metrics wrapping a line differently, a hairline gone,
 * a weight thinned) is visible as a ghost instead of a memory.
 *
 * The overlay is a second offscreen source main keeps only while the skin
 * is on (`TabSession.reference`), following the target's URL, viewport,
 * text scale and scroll; its frames reach the renderer on their own
 * channel and land in a second texture the canvas draws over the first
 * with the same panel simulation. The opacity itself is renderer state:
 * main only needs to know whether the reference exists.
 *
 * `0` is off, and the only value ever persisted is nothing: every launch
 * starts without a skin, like the throttle.
 */

/** The steps the toolbar offers; an agent may set any value in [0, 1]. */
export const ONION_STEPS = [0, 0.25, 0.5, 0.75, 1] as const

export const DEFAULT_ONION_SKIN = 0

/** The reference's density. The host's own on a Retina Mac, and the HiDPI truth on any host. */
export const REFERENCE_DSF = 2

export function isOnionSkin(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1
}

/** A wire value into an opacity; null when it is not one. */
export function parseOnionSkin(raw: unknown): number | null {
  return isOnionSkin(raw) ? raw : null
}

/** `off`, or a percentage: what the toolbar and the footer say. */
export function formatOnionSkin(v: number): string {
  return v <= 0 ? 'off' : `${Math.round(v * 100)}%`
}

/**
 * Whether a reference at `REFERENCE_DSF` can be rendered for this CSS
 * viewport within the device-pixel budget. A 4K or ultrawide desktop
 * preset at 1x is already at the budget's edge; doubling it is not a
 * picture of anything, so the skin is refused rather than rendered at a
 * clamped, mismatched viewport.
 */
export function referenceFits(cssWidth: number, cssHeight: number, maxDevicePx: number): boolean {
  return cssWidth * REFERENCE_DSF <= maxDevicePx && cssHeight * REFERENCE_DSF <= maxDevicePx
}

/**
 * The sentence a refused skin carries, or null when the viewport can have
 * one. The refusal already happened silently: `onionSkin` read back as 0,
 * which is also what off and an app older than the field answer, so an agent
 * that set 0.5 and read 0 could not tell "turned off" from "could not".
 */
export function onionSkinRefusal(cssWidth: number, cssHeight: number, maxDevicePx: number): string | null {
  if (referenceFits(cssWidth, cssHeight, maxDevicePx)) return null
  const side = Math.floor(maxDevicePx / REFERENCE_DSF)
  return (
    `the onion skin was left off: it blends a ${REFERENCE_DSF}x render of the page over the target, and at this ` +
    `${cssWidth}x${cssHeight} viewport that render would be ${cssWidth * REFERENCE_DSF}x${cssHeight * REFERENCE_DSF} ` +
    `device px, past the ${maxDevicePx} px limit; a screen up to ${side} CSS px on each side can have one`
  )
}
