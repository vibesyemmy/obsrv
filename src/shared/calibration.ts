import { MAX_VIEWPORT } from './presets'

export interface HostDisplay {
  physicalWidth: number
  physicalHeight: number
  diagonalInches: number
  scaleFactor: number
}

export interface TargetScreen {
  width: number
  height: number
  diagonalInches: number
}

export function ppi(width: number, height: number, diagonalInches: number): number {
  if (!(diagonalInches > 0)) throw new RangeError('diagonalInches must be > 0')
  return Math.hypot(width, height) / diagonalInches
}

/** Physical host pixels per target pixel. */
export function computeScale(host: HostDisplay, target: TargetScreen, pixelExact: boolean): number {
  if (pixelExact) return host.scaleFactor
  return ppi(host.physicalWidth, host.physicalHeight, host.diagonalInches) / ppi(target.width, target.height, target.diagonalInches)
}

export function clampViewport(width: number, height: number, max = MAX_VIEWPORT): { width: number; height: number; clamped: boolean } {
  const w = Math.min(max, Math.max(1, Math.floor(width)))
  const h = Math.min(max, Math.max(1, Math.floor(height)))
  return { width: w, height: h, clamped: w !== width || h !== height }
}
