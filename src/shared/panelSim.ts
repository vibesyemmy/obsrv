import type { PanelParams, PanelProfile } from './types'
import { applyMatrix, type Matrix3 } from './vision'

export function profileToParams(p: PanelProfile, hostNits: number): PanelParams {
  if (!(hostNits > 0)) throw new RangeError('hostNits must be > 0')
  return {
    brightness: p.nits === null ? 1 : p.nits / hostNits,
    blackFloor: p.contrastRatio === null ? 0 : 1 / p.contrastRatio,
    gamut: p.gamutCoverage,
    levels: 2 ** p.bits - 1,
    dither: p.frc,
  }
}

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5] as const

/** Ordered 4x4 dither threshold in [0,1). Must match bayer4() in shaders.ts. */
export function bayer(x: number, y: number): number {
  return BAYER4[((y & 3) * 4 + (x & 3)) as 0]! / 16
}

const GAMMA = 2.2
const toLinear = (v: number): number => Math.pow(v, GAMMA)
const toEncoded = (v: number): number => Math.pow(v, 1 / GAMMA)
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v))

export type RGB = [number, number, number]

/**
 * Reference implementation of the panel shader. Input/output are 0..255 sRGB-encoded.
 * (x, y) are the target-pixel coordinates, used only for dithering.
 *
 * `vision` is the viewer, not the panel, so it runs last — after the bit-depth
 * quantisation, on the light the display has actually emitted. Running it
 * earlier would quantise the eye's output instead of the screen's. Pass the
 * identity (or omit it) for normal vision.
 */
export function simulatePixel(rgb: RGB, params: PanelParams, x = 0, y = 0, vision?: Matrix3): RGB {
  let c = rgb.map(v => toLinear(v / 255)) as RGB
  // Black floor is leakage through the panel's own backlight, so it scales with brightness.
  c = c.map(v => params.brightness * (params.blackFloor + (1 - params.blackFloor) * v)) as RGB
  const l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
  c = c.map(v => l + (v - l) * params.gamut) as RGB
  c = c.map(v => toEncoded(clamp01(v))) as RGB
  const d = params.dither ? bayer(x, y) - 0.5 : 0
  c = c.map(v => Math.floor(v * params.levels + d + 0.5) / params.levels) as RGB
  if (vision) {
    // Back to linear for the eye: the matrix models cone response, which acts
    // on light, and applying it to gamma-encoded values is the mistake that
    // makes most online simulators produce plausible-but-wrong colours.
    const [r, g, b] = applyMatrix(vision, ...(c.map(v => toLinear(clamp01(v))) as RGB))
    c = [r, g, b].map(v => toEncoded(clamp01(v))) as RGB
  }
  return c.map(v => Math.round(clamp01(v) * 255)) as RGB
}
