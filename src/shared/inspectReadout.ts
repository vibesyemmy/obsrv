import { ppi as ppiOf } from './calibration'
import { cssPxToMm, effectiveContrast, hex } from './contrast'
import type { InspectReport } from './inspect'
import type { PanelParams } from './types'
import type { Matrix3 } from './vision'

/**
 * The inspector's report turned into what an agent (or the CLI) can act
 * on: the element, its font in millimetres on this screen, its colours,
 * and its contrast twice — as stated, and as the panel profile would show
 * it — against the WCAG threshold that applies to text of that size. The
 * same maths the footer readout does, without the footer.
 */

export interface InspectScreen {
  cssWidth: number
  cssHeight: number
  deviceScaleFactor: number
  /** Null for a custom screen with no diagonal: no density, no millimetres. */
  diagonalInches: number | null
  /** Browser zoom as reflow; the report's font size is the page's own CSS px. */
  textScale: number
}

export interface InspectPanel {
  profileId: string
  profileLabel: string
  /** The profile's simulation parameters; the reference profile's are the identity. */
  params: PanelParams
  /** A colour-vision simulation, when one is in force (the live app only). */
  vision?: { label: string; matrix: Matrix3 }
}

export interface InspectContrast {
  /** The pair as stated, composited: what a reference display shows. */
  asIs: number
  /** The same pair through the panel profile (and the vision setting, when set). */
  onPanel: number
  /** WCAG 2's large-text rule: 24 px and up, or 18.66 px and up at weight 700+. */
  largeText: boolean
  /** 3:1 for large text, 4.5:1 otherwise. */
  aaThreshold: number
  passesAsIs: boolean
  passesOnPanel: boolean
  panel: string
  vision?: string
}

export interface InspectReadout {
  /** `tag#id.first-class`, the footer's element name. */
  element: string
  tag: string
  id: string
  classes: string
  text: string
  /** The element's border box in CSS px of the screen (surface), as the report gives it. */
  rect: { x: number; y: number; width: number; height: number }
  /**
   * The same box in page CSS px, scroll included — the space an audit
   * finding's rect is in, and what `highlight { space: 'page' }` takes. The
   * viewport rect plus the target's scroll as the app records it; equal to
   * `rect` on a headless load, which is at the top.
   */
  pageRect: { x: number; y: number; width: number; height: number }
  /** The same box in millimetres on this screen; null without a diagonal. */
  rectMm: { width: number; height: number } | null
  font: { px: number; mm: number | null; weight: number; family: string }
  color: string
  /** Null when an image or gradient is under the text. */
  background: string | null
  backgroundNote: 'computed' | 'image'
  /** Null when the background could not be computed. */
  contrast: InspectContrast | null
  /** Device pixels per inch of the screen; null without a diagonal. */
  ppi: number | null
}

const round = (v: number, places: number): number => Math.round(v * 10 ** places) / 10 ** places

export function isLargeText(fontSizePx: number, fontWeight: number): boolean {
  return fontSizePx >= 24 || (fontSizePx >= 18.66 && fontWeight >= 700)
}

export function inspectReadout(
  report: InspectReport,
  screen: InspectScreen,
  panel: InspectPanel,
  scroll: { x: number; y: number } = { x: 0, y: 0 },
): InspectReadout {
  const ppi =
    screen.diagonalInches === null
      ? null
      : ppiOf(screen.cssWidth * screen.deviceScaleFactor, screen.cssHeight * screen.deviceScaleFactor, screen.diagonalInches)
  // The box is in the screen's CSS px already; the font size is the page's
  // own, which under a text scale is that many times larger on the glass.
  const boxMm = (px: number): number | null => (ppi === null ? null : round(cssPxToMm(px, screen.deviceScaleFactor, ppi), 2))
  const fontMm = ppi === null ? null : round(cssPxToMm(report.fontSizePx, screen.deviceScaleFactor * screen.textScale, ppi), 2)

  const firstClass = report.classes.split(/\s+/).find(c => c.length > 0)
  const element = `${report.tag}${report.id ? `#${report.id}` : ''}${firstClass ? `.${firstClass}` : ''}`

  let contrast: InspectContrast | null = null
  if (report.background !== null) {
    const large = isLargeText(report.fontSizePx, report.fontWeight)
    const threshold = large ? 3 : 4.5
    const c = effectiveContrast(report.color, report.background, panel.params, panel.vision?.matrix)
    contrast = {
      asIs: round(c.asIs, 2),
      onPanel: round(c.onPanel, 2),
      largeText: large,
      aaThreshold: threshold,
      passesAsIs: c.asIs >= threshold,
      passesOnPanel: c.onPanel >= threshold,
      panel: panel.profileId,
      ...(panel.vision ? { vision: panel.vision.label } : {}),
    }
  }

  return {
    element,
    tag: report.tag,
    id: report.id,
    classes: report.classes,
    text: report.text,
    rect: {
      x: round(report.rect.x, 1),
      y: round(report.rect.y, 1),
      width: round(report.rect.width, 1),
      height: round(report.rect.height, 1),
    },
    pageRect: {
      x: round(report.rect.x + scroll.x, 1),
      y: round(report.rect.y + scroll.y, 1),
      width: round(report.rect.width, 1),
      height: round(report.rect.height, 1),
    },
    rectMm: ppi === null ? null : { width: boxMm(report.rect.width)!, height: boxMm(report.rect.height)! },
    font: { px: report.fontSizePx, mm: fontMm, weight: report.fontWeight, family: report.fontFamily },
    color: hex(report.color),
    background: report.background === null ? null : hex(report.background),
    backgroundNote: report.backgroundNote,
    contrast,
    ppi: ppi === null ? null : Math.round(ppi),
  }
}
