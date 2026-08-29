import { MAX_VIEWPORT } from './presets'
import type { Orientation } from './types'

export interface HostDisplay {
  physicalWidth: number
  physicalHeight: number
  diagonalInches: number
  scaleFactor: number
}

export interface TargetScreen {
  /** CSS pixels; the physical raster is this x `deviceScaleFactor`. */
  width: number
  height: number
  diagonalInches: number
  /** Device pixels per CSS pixel; omitted means 1 (every 1x monitor preset). */
  deviceScaleFactor?: number
}

/**
 * The screen as it is actually being held. The **one** place the axes are
 * swapped: everything downstream — the viewport handed to `TargetSource`, the
 * clamp, the magnification, the footer — reads the rotated screen and needs no
 * orientation of its own.
 *
 * Rotation must not change the *magnitude* of the physical scale, and does not:
 * `ppi` is `hypot(w, h) / diagonalInches` and `hypot` is symmetric, so the
 * diagonal, the pixel count and the density are all orientation-independent.
 * A phone does not get physically larger by being turned sideways. The unit
 * test asserts it, because it is exactly the kind of thing that drifts.
 *
 * `'portrait'` is the preset as the table stores it; `'landscape'` is that
 * rotated a quarter turn. Every mobile preset — the case this feature exists
 * for — is stored portrait, so for those the names are literal. A monitor
 * preset is stored landscape-natural, so there the pair reads as
 * unrotated/rotated instead; the UI never repeats the flag back at the user,
 * it names the shape the dimensions actually have (`screenShape`), so nothing
 * on screen can contradict the pixels beside it.
 */
export function applyOrientation<T extends TargetScreen>(screen: T, orientation: Orientation): T {
  if (orientation !== 'landscape') return screen
  return { ...screen, width: screen.height, height: screen.width }
}

/**
 * The shape a pair of dimensions actually has, for anything the user reads. A
 * square screen counts as portrait — it has no landscape reading, and one of
 * the two words has to win.
 */
export function screenShape(width: number, height: number): Orientation {
  return width > height ? 'landscape' : 'portrait'
}

export function ppi(width: number, height: number, diagonalInches: number): number {
  if (!(diagonalInches > 0)) throw new RangeError('diagonalInches must be > 0')
  return Math.hypot(width, height) / diagonalInches
}

/**
 * Physical host pixels per target *device* pixel. The target's PPI is a
 * device-pixel density: a 393x852 CSS phone at 3x packs 1179x2556 pixels into
 * its 6.1" diagonal, so each of them gets ~0.3 host pixels on a desktop
 * monitor — physically smaller than any 1x screen's pixel, which is the point.
 */
export function computeScale(host: HostDisplay, target: TargetScreen, pixelExact: boolean): number {
  if (pixelExact) return host.scaleFactor
  const dsf = target.deviceScaleFactor ?? 1
  return (
    ppi(host.physicalWidth, host.physicalHeight, host.diagonalInches) /
    ppi(target.width * dsf, target.height * dsf, target.diagonalInches)
  )
}

/**
 * The CSS-pixel budget for a surface rasterising at `deviceScaleFactor`:
 * `MAX_VIEWPORT` limits *device* pixels, so the CSS clamp shrinks with the
 * factor (393x852 at 3x is 1179x2556 device pixels and fits). A non-finite or
 * sub-1 factor counts as 1.
 */
export function maxCssViewport(deviceScaleFactor: number): number {
  const dsf = Number.isFinite(deviceScaleFactor) && deviceScaleFactor > 1 ? deviceScaleFactor : 1
  return Math.max(1, Math.floor(MAX_VIEWPORT / dsf))
}

export function clampViewport(width: number, height: number, max = MAX_VIEWPORT): { width: number; height: number; clamped: boolean } {
  const finite = (v: number): number => (Number.isFinite(v) ? v : 1)
  const w = Math.min(max, Math.max(1, Math.floor(finite(width))))
  const h = Math.min(max, Math.max(1, Math.floor(finite(height))))
  return { width: w, height: h, clamped: w !== width || h !== height }
}
