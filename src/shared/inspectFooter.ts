import { ppi } from './calibration'
import { cssPxToMm, effectiveContrast, formatRatio, hex, paintedColor } from './contrast'
import type { InspectReport } from './inspect'
import type { PanelParams } from './types'
import type { Matrix3 } from './vision'

/** What the app's footer needs besides the report, each as the footer already reads it from the store. */
export interface InspectFooterContext {
  /** The target's raster density; a font's device px are `px × dsf × textScale`. */
  dsf: number
  textScale: number
  /** The screen in force, for its pixel density. */
  screen: { width: number; height: number; diagonalInches: number }
  params: PanelParams
  profile: { id: string; label: string }
  /** The viewer simulation, when one is on. */
  vision: { matrix: Matrix3; label: string } | null
}

const round2 = (n: number): number => Math.round(n * 100) / 100

/**
 * What the app's footer says about an inspected element: which element, its
 * font in px and mm, the colour pair, and the contrast as shown and on the
 * panel. Out of `PaneFooter` so its figures can be held to the readout's
 * (`inspectReadout`). The footer passed no `opacity`, so text at `opacity: .5`
 * read at the ratio of a fully opaque colour here while `obsrv inspect` and
 * `obsrv_inspect` gave the composited one, and the footer is where a person
 * reads it (bug-app-inspect-footer-ignores-opacity).
 */
export function inspectFooterFacts(r: InspectReport, ctx: InspectFooterContext): string[] {
  const firstClass = r.classes.split(/\s+/).find(c => c.length > 0)
  const element = `${r.tag}${r.id ? `#${r.id}` : ''}${firstClass ? `.${firstClass}` : ''}`
  // The font size is the page's own CSS px; under a text scale each is
  // `textScale` device px more, and the density is still the screen's.
  const mm = cssPxToMm(r.fontSizePx, ctx.dsf * ctx.textScale, ppi(ctx.screen.width * ctx.dsf, ctx.screen.height * ctx.dsf, ctx.screen.diagonalInches))
  const sizeFact = `${Number.isInteger(r.fontSizePx) ? r.fontSizePx : r.fontSizePx.toFixed(1)}px${
    Number.isFinite(mm) ? ` = ${mm.toFixed(1)} mm` : ''
  }${r.fontWeight !== 400 ? ` w${r.fontWeight}` : ''}`
  const stated = hex(r.color)
  // Over an image or gradient nothing stated is the colour under the text,
  // and the readout says so rather than guessing.
  if (!r.background) return [element, sizeFact, `${stated} on an image`, 'contrast not measurable']
  // The colour the screen shows, as the readout gives it: composited at its
  // own alpha and the element's opacity. The page's own colour follows in
  // brackets when the two differ, so the pair can still be found in the
  // stylesheet.
  const painted = hex(paintedColor(r.color, r.background, r.opacity))
  const how = [...(r.color[3] < 1 ? [`alpha ${round2(r.color[3])}`] : []), ...(r.opacity < 1 ? [`opacity ${round2(r.opacity)}`] : [])]
  const pair =
    painted === stated || how.length === 0
      ? `${stated} on ${hex(r.background)}`
      : `${painted} on ${hex(r.background)} (${stated} at ${how.join(', ')})`
  const c = effectiveContrast(r.color, r.background, ctx.params, ctx.vision?.matrix, r.opacity)
  // The panel's ratio is left out only when it would repeat the first: the
  // reference panel, seen without a simulation.
  const plain = ctx.profile.id === 'reference' && ctx.vision === null
  return [
    element,
    sizeFact,
    pair,
    `${formatRatio(c.asIs)} here`,
    ...(plain ? [] : [`${formatRatio(c.onPanel)} on ${ctx.profile.label}${ctx.vision ? ` for ${ctx.vision.label}` : ''}`]),
  ]
}
