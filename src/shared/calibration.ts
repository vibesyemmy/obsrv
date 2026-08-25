import { MAX_VIEWPORT } from './presets'

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
