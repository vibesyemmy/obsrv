import type { RGBA } from './inspect'
import { simulatePixel, type RGB } from './panelSim'
import type { PanelParams } from './types'
import type { Matrix3 } from './vision'

/**
 * Contrast as WCAG 2 defines it, and contrast as a given panel would show
 * it. The second number is the point: a pair that clears 4.5:1 on the
 * display the page was designed on can fall under 3:1 once a budget panel's
 * black floor lifts the dark colour and its gamut pulls the two together.
 * The panel figure runs the two colours through the same `simulatePixel`
 * the shader is parity-tested against, dithering off — a single colour has
 * no neighbours to dither with, and the mean level is what an eye averages.
 */

/** sRGB channel (0..255) to linear light, the piecewise curve WCAG specifies. */
function channelToLinear(v: number): number {
  const c = Math.min(1, Math.max(0, v / 255))
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function relativeLuminance([r, g, b]: RGB): number {
  return 0.2126 * channelToLinear(r) + 0.7152 * channelToLinear(g) + 0.0722 * channelToLinear(b)
}

/** WCAG contrast ratio, 1..21, order-independent. */
export function contrastRatio(a: RGB, b: RGB): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

/** Alpha-composites a colour onto an opaque one. */
export function over(top: RGBA, under: RGB): RGB {
  const a = Math.min(1, Math.max(0, top[3]))
  return [
    top[0] * a + under[0] * (1 - a),
    top[1] * a + under[1] * (1 - a),
    top[2] * a + under[2] * (1 - a),
  ]
}

/** The colour a panel (and, optionally, a viewer) would make of one. */
export function onPanel(rgb: RGB, params: PanelParams, vision?: Matrix3): RGB {
  return simulatePixel(rgb, { ...params, dither: false }, 0, 0, vision)
}

export interface EffectiveContrast {
  /** The pair as stated, composited: what a reference display shows. */
  asIs: number
  /** The same pair after the panel profile and the vision setting. */
  onPanel: number
}

/**
 * The colour the screen actually shows for this text: its own alpha and the
 * effective `opacity` of its ancestor chain, composited onto what is under it.
 *
 * This is what the ratio has always been computed from — `over(color, bg)` —
 * and what was never printed. A readout that states `#ffffff` beside a ratio
 * of 7.72 invites the reader to check the arithmetic, find 19.56, and conclude
 * the tool is broken; the tool was describing `#a3a3a3`. Measured on
 * lobste.rs, whose upvoter paints #a1a1a1 and was reported as white
 * (docs/research/2026-09-15-contrast-figure.md).
 *
 * `opacity` multiplies the colour's own alpha rather than replacing it: a page
 * may use both, and the two compose.
 */
export function paintedColor(color: RGBA, background: RGBA, opacity = 1): RGB {
  const bg = over(background, [255, 255, 255])
  const a = Math.min(1, Math.max(0, opacity)) * Math.min(1, Math.max(0, color[3]))
  return over([color[0], color[1], color[2], a], bg)
}

/**
 * `opacity` is the element's effective opacity — the product down its ancestor
 * chain — and defaults to 1, so every existing caller keeps its answer.
 *
 * It belongs here rather than in the caller because an `opacity` that greys
 * text changes what a reader sees and therefore what the verdict should be:
 * before this, `color: #fff` under `opacity: .62` on #0c0c0c was judged 19.56,
 * a ratio of a white that is not on the screen.
 */
export function effectiveContrast(
  color: RGBA,
  background: RGBA,
  params: PanelParams,
  vision?: Matrix3,
  opacity = 1,
): EffectiveContrast {
  const bg = over(background, [255, 255, 255])
  const fg = paintedColor(color, background, opacity)
  return {
    asIs: contrastRatio(fg, bg),
    onPanel: contrastRatio(onPanel(fg, params, vision), onPanel(bg, params, vision)),
  }
}

/**
 * A CSS length in millimetres on the target screen. `ppi` is the screen's
 * device-pixel density (`calibration.ppi`), so CSS pixels are multiplied by
 * the scale factor first.
 */
export function cssPxToMm(px: number, deviceScaleFactor: number, ppi: number): number {
  if (!(ppi > 0)) return NaN
  return ((px * deviceScaleFactor) / ppi) * 25.4
}

/** `#rrggbb` of a colour, alpha ignored — the readout shows the composited pair. */
export function hex([r, g, b]: RGB | RGBA): string {
  const h = (v: number): string => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')
  return `#${h(r)}${h(g)}${h(b)}`
}

/** One decimal, the way contrast is quoted: `4.8:1`. */
export function formatRatio(ratio: number): string {
  return `${ratio.toFixed(1)}:1`
}
