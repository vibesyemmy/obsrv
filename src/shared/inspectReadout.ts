import { ppi as ppiOf } from './calibration'
import { cssPxToMm, effectiveContrast, hex, paintedColor } from './contrast'
import type { InspectReport } from './inspect'
import { layoutScale, layoutScaleNote } from './layoutScale'
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
  /** The colour as the page states it: computed `color`, alpha discarded. */
  color: string
  /**
   * The colour the screen actually shows — the stated colour after its own
   * alpha and the element's effective `opacity`, composited onto the
   * background. Equal to `color` whenever the text is fully opaque, which is
   * most of the time; different is the case worth seeing, and it is the colour
   * the contrast figures describe.
   */
  colorPainted: string
  /** Null when an image or gradient is under the text. */
  background: string | null
  backgroundNote: 'computed' | 'image'
  /** Null when the background could not be computed. */
  contrast: InspectContrast | null
  /** Device pixels per inch of the screen; null without a diagonal. */
  ppi: number | null
  /**
   * How much smaller the page is drawn than it is laid out (`shared/layoutScale`):
   * 1 for a page that fits its screen, 360/980 for one with no viewport meta
   * on a 360 px phone. The millimetres are of the element as drawn; `rect`,
   * `pageRect` and `font.px` are in the page's own layout px.
   */
  layoutScale: number
  /** What the reader should know about the figures: the layout scale, when it is not 1. */
  notes: string[]
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
  // The box is in the page's CSS px, which are the screen's unless the page
  // is drawn scaled to fit (no viewport meta on a phone); the font size is
  // the page's own, which under a text scale is that many times larger on
  // the glass.
  const layoutWidth = report.viewportWidth ?? 0
  const scale = layoutScale(screen.cssWidth, screen.textScale, layoutWidth)
  const scaleNote = layoutScaleNote(scale, layoutWidth, screen.cssWidth / screen.textScale)
  const boxMm = (px: number): number | null => (ppi === null ? null : round(cssPxToMm(px * scale, screen.deviceScaleFactor, ppi), 2))
  const fontMm = ppi === null ? null : round(cssPxToMm(report.fontSizePx * scale, screen.deviceScaleFactor * screen.textScale, ppi), 2)

  const firstClass = report.classes.split(/\s+/).find(c => c.length > 0)
  const element = `${report.tag}${report.id ? `#${report.id}` : ''}${firstClass ? `.${firstClass}` : ''}`

  // What the screen shows, and the note when that is not what the page says.
  // Without a background nothing can be composited, so the stated colour is
  // the only answer available and the readout does not pretend otherwise.
  const painted =
    report.background === null ? hex(report.color) : hex(paintedColor(report.color, report.background, report.opacity))
  const paintedNote =
    painted === hex(report.color)
      ? null
      : `the page states ${hex(report.color)} and the screen shows ${painted}: ${
          report.opacity < 1 ? `an opacity of ${round(report.opacity, 2)}` : 'the colour\u2019s own alpha'
        } composites it onto the background, and the contrast figures are of what is shown`

  // Nothing here is on the screen, and every figure below describes it anyway.
  // `audit` skips an element this rule rejects, so on one page `audit` called
  // the smallest text 10 px while `inspect` measured a hidden 4 px paragraph
  // and passed its contrast at 18.88:1. The measurements are kept — the
  // selector matched, and what the element WOULD be is a fair question — and
  // the note says they are of something nobody can see.
  // Keyed on the two values that mean something rather than on `!== null`: a
  // report built before this field carries `undefined`, and a "not drawn" note
  // on every such report would be the same kind of confident wrong answer the
  // note exists to prevent.
  const hiddenNote =
    report.hidden !== 'display' && report.hidden !== 'visibility'
      ? null
      : // Each rule says where it was found, because the two are not found the
        // same way. `display: none` anywhere above takes the element off the
        // screen. `visibility: hidden` is read on the element itself — its
        // computed value already carries any inheritance, and a descendant
        // that declares `visible` under a hidden parent IS painted, so naming
        // an ancestor here would be wrong (fixed in 0.61.0; see shared/inspect.ts).
        `this element is not drawn: ${
          report.hidden === 'display'
            ? 'display: none on it or on an ancestor'
            : 'visibility: hidden in its computed style'
        }. The measurements below are of a box the screen never shows, and the contrast verdict is not a verdict about anything a reader sees.`

  let contrast: InspectContrast | null = null
  if (report.background !== null) {
    const large = isLargeText(report.fontSizePx, report.fontWeight)
    const threshold = large ? 3 : 4.5
    const c = effectiveContrast(report.color, report.background, panel.params, panel.vision?.matrix, report.opacity)
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
    colorPainted: painted,
    background: report.background === null ? null : hex(report.background),
    backgroundNote: report.backgroundNote,
    contrast,
    ppi: ppi === null ? null : Math.round(ppi),
    layoutScale: round(scale, 4),
    notes: [hiddenNote, scaleNote, paintedNote].filter((n): n is string => n !== null),
  }
}

/**
 * The sentence an inspect by selector carries when the string is not a CSS
 * selector at all. `p[` and `#no-such-thing` used to produce the same answer —
 * `found: false`, no note — so a typo read as "that element is not on the
 * page", and the agent went looking for why the page had changed. Nothing was
 * looked for: the browser rejected the string before any matching happened.
 *
 * The distinction is made in the page ask (`inspectTarget` returns a marker)
 * and travels as a note, not as a thrown error, because the surrounding notes
 * — which page answered, what its status was — are worth as much on a typo as
 * on a hit, and an error would throw them away.
 */
export function invalidSelectorNote(selector: string): string {
  return (
    `${JSON.stringify(selector)} is not a valid CSS selector, so nothing was looked for — found: false is about ` +
    `the selector, not the page: the element may well be there. Unbalanced brackets or quotes, an XPath, and jQuery ` +
    `extensions such as :contains() are the usual causes; :has() and :is() are valid CSS and are accepted`
  )
}

/**
 * The sentence an inspect at a point carries when the point is not on the
 * screen. Without it, `found: false` for (1000, 500) on a 412-wide phone reads
 * as nothing drawn there, and an agent concludes the page is empty there, when
 * the point is not on this screen at all. (A blank stretch of page answers what
 * lies under it, `body` or `html`, not `found: false`.) Null when the point is
 * on the screen.
 *
 * The coordinate space is the click's (`parseClick` in `shared/control`):
 * `[0, width) × [0, height)` in CSS px of the viewport as set, which is what
 * `inspectAt` takes on both surfaces. It is the geometry, not the hit test:
 * Chromium reads the point at the nearest whole page pixel, so a point in the
 * last half pixel before the edge (411.5 on a 412-wide screen, measured) finds
 * nothing and gets no sentence. The sentence stays true where it is said,
 * rather than modelling that rounding under a text or layout scale.
 */
export function pointOffScreenNote(at: { x: number; y: number }, viewport: { width: number; height: number }): string | null {
  const { x, y } = at
  if (x >= 0 && y >= 0 && x < viewport.width && y < viewport.height) return null
  return (
    `the point (${x}, ${y}) is outside this screen's CSS viewport, ${viewport.width}x${viewport.height}, and a point is read ` +
    `inside the viewport, so nothing can be found there — found: false is about the point, not the page; ` +
    `to read an element that is not on screen, use --selector (selector)`
  )
}
