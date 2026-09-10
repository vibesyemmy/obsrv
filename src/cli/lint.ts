import { effectiveContrast, hex, relativeLuminance } from '../shared/contrast'
import { layoutScale, layoutScaleNote } from '../shared/layoutScale'
import type { LintEdgeKind, LintRect, LintReport, LintObjectFit } from '../shared/lint'
import type { PanelParams } from '../shared/types'
import type { Matrix3 } from '../shared/vision'

/**
 * The lint: rules over a page's rendered DOM for the things a 1x screen
 * and a cheap panel break — judged here, outside the page, where the
 * screen's density, the text scale and the panel profile are known. Pure:
 * no Electron, no I/O, unit-tested under plain node, like the audit.
 *
 * Every rule is about device pixels or the panel, never CSS pixels alone:
 * a 0.5px border is a hairline on a 1x screen and a whole pixel on a 2x
 * one; 300-weight text at 12px is sub-pixel strokes on a monitor and fine
 * on a phone; a colour pair that clears WCAG on the display it was designed
 * on can fail once a budget panel lifts its blacks. The thresholds that are
 * judgement calls are stated in the output.
 */

/** Text lighter than regular below this many device pixels of font size is flagged. */
export const DEFAULT_THIN_PX = 14
/** An image whose natural width is this many times its drawn device width is oversized. */
export const IMAGE_OVERSIZED_FACTOR = 2
/** An image drawn wider than its natural width by more than this is upscaled (a little slack for rounding). */
export const IMAGE_UPSCALED_TOLERANCE = 0.98

/**
 * The scale Chromium draws a file at inside its box, per `object-fit`: one
 * number on each axis. `cover` scales by the larger axis and crops, `contain`
 * and `scale-down` by the smaller (the latter never above 1), `none` not at
 * all, and `fill` — the default — stretches each axis on its own, so a
 * 960×331 file filling a 551×567 box is downsampled 1.7× across and upscaled
 * 1.7× down at the same time. The width alone, which is what this judged
 * until 0.48.0, called ebay.co.uk's cover-fit hero "upscaled 1.15×" when its
 * height was scaled 3.4×, and passed that same file in a cover box on a 1x
 * screen with no finding at all.
 */
export function imageScale(
  natural: { width: number; height: number },
  drawn: { width: number; height: number },
  fit: LintObjectFit = 'fill',
): { x: number; y: number } {
  const x = drawn.width / natural.width
  const y = drawn.height / natural.height
  switch (fit) {
    case 'cover': {
      const s = Math.max(x, y)
      return { x: s, y: s }
    }
    case 'contain': {
      const s = Math.min(x, y)
      return { x: s, y: s }
    }
    case 'scale-down': {
      const s = Math.min(1, x, y)
      return { x: s, y: s }
    }
    case 'none':
      return { x: 1, y: 1 }
    default:
      return { x, y }
  }
}
/** Findings past this are counted, not listed; the worst come first. */
export const LINT_MAX_FINDINGS = 200

/**
 * The sentence about the capped list, for whoever prints the list: the CLI's
 * JSON, the MCP unless `groupsOnly`. Not the report, which shows groups and
 * never the list — a line there about "the 200 listed" was about something
 * the reader could not see — and not `lintFindings` itself, which does not
 * know who is reading. Null when nothing was left out.
 */
export function listTruncationNote(truncated: number): string | null {
  if (truncated <= 0) return null
  return `${truncated} more finding${truncated === 1 ? '' : 's'} past the ${LINT_MAX_FINDINGS} listed; the summary counts them all`
}

/**
 * When the walk before the lint stopped short of the end (its budget ran
 * out), the images below the height it reached were never scrolled into
 * view, and a lazy loader never swapped their placeholders: an "upscaled"
 * finding down there may be a 1×1 GIF judged against a real box. Counts the
 * image findings past that height, for the warnings. Null when there are
 * none — or when the walk reached the end, since then there is no such
 * height.
 */
export function unwalkedImageNote(findings: LintFinding[], walkedHeightPx: number): string | null {
  const n = findings.filter(f => (f.rule === 'image-upscaled' || f.rule === 'image-oversized') && f.rect.y >= walkedHeightPx).length
  if (n === 0) return null
  return (
    `${n} image finding${n === 1 ? '' : 's'} sit${n === 1 ? 's' : ''} below the ${Math.round(walkedHeightPx)} CSS px the walk reached ` +
    `before its budget ran out, and may be placeholders the page never loaded`
  )
}

export type LintRule = 'hairline' | 'thin-text' | 'contrast' | 'contrast-on-panel' | 'image-upscaled' | 'image-oversized'
export const LINT_RULES: readonly LintRule[] = ['hairline', 'thin-text', 'contrast', 'contrast-on-panel', 'image-upscaled', 'image-oversized']

export interface LintScreen {
  cssWidth: number
  cssHeight: number
  deviceScaleFactor: number
  /** Browser zoom as reflow, 1 (or absent) = none; multiplies the density for every device-pixel figure. */
  textScale?: number
}

export interface LintPanel {
  profileId: string
  profileLabel: string
  params: PanelParams
  /** A colour-vision simulation in force (live), applied after the panel. */
  vision?: { label: string; matrix: Matrix3 }
}

export interface LintThresholds {
  thinPx: number
}

interface FindingBase {
  element: string
  text: string
  /** Page CSS px, scroll included: what `obsrv_drive`'s highlight takes with `space: 'page'`. */
  rect: LintRect
  /** One sentence for the reader, with the figures in it. */
  message: string
}

export type LintFinding =
  | (FindingBase & { rule: 'hairline'; kind: LintEdgeKind; cssPx: number; devicePx: number })
  | (FindingBase & { rule: 'thin-text'; fontSizePx: number; fontWeight: number; devicePx: number })
  | (FindingBase & {
      rule: 'contrast' | 'contrast-on-panel'
      fontSizePx: number
      fontWeight: number
      color: string
      background: string
      asIs: number
      onPanel: number
      threshold: number
      largeText: boolean
    })
  | (FindingBase & {
      rule: 'image-upscaled' | 'image-oversized'
      naturalWidth: number
      /** How the file is fitted into its box; the axis the factor follows depends on it. */
      objectFit: LintObjectFit
      naturalHeight: number
      drawnDevicePx: { width: number; height: number }
      factor: number
      srcset: boolean
      candidates: string[]
      /** The descriptor of the candidate Chromium chose, when the walk could match it. */
      chosen?: string
      src: string
    })

/** Findings that share a cause, counted together; the list caps at 200, the groups do not. */
export interface LintGroup {
  rule: LintRule
  /** What the members share: a text colour on light, mid-tone or dark backgrounds; a weight and size; an edge kind and thickness; a srcset-or-not and a factor bucket. */
  key: string
  count: number
  /** The worst member, as listed: first in the rule's worst-first order. */
  exemplar: LintFinding
  /** Up to a few distinct elements, for the reader. */
  elements: string[]
}
/**
 * A group as the CLI and the MCP hand it out: the exemplar cut down to where
 * it is and what it says. The full finding is in `findings` (or, past the
 * cap, counted); repeating it here doubled the payload for nothing.
 */
export interface LintGroupSummary {
  rule: LintRule
  key: string
  count: number
  elements: string[]
  exemplar: { element: string; text: string; rect: LintRect; message: string }
}
export function slimGroups(groups: LintGroup[]): LintGroupSummary[] {
  return groups.map(g => ({
    rule: g.rule,
    key: g.key,
    count: g.count,
    elements: g.elements,
    exemplar: { element: g.exemplar.element, text: g.exemplar.text, rect: g.exemplar.rect, message: g.exemplar.message },
  }))
}

/** Text whose colour is its background's: hidden by design (a mask, a reveal) or broken; not a contrast verdict. */
export const INVISIBLE_CONTRAST = 1.1

/** How many times over, in the buckets a reader thinks in. */
function factorBucket(rule: 'image-upscaled' | 'image-oversized', factor: number): string {
  if (rule === 'image-upscaled') return factor < 1.5 ? 'under 1.5×' : factor < 2 ? '1.5–2×' : factor < 3 ? '2–3×' : '3× and over'
  return factor < 3 ? '2–3×' : factor < 5 ? '3–5×' : factor < 10 ? '5–10×' : '10× and over'
}

/** Groups are few by nature; this bounds a pathological page. */
export const LINT_MAX_GROUPS = 100
export const LINT_GROUP_ELEMENTS = 5

/**
 * The band a background sits in, for grouping: a text colour that fails on
 * one near-white fails on its neighbours too, and a page's links sit on a
 * dozen of them (Wikipedia: #ffffff, #fdfdfd, #f7f7f7, #f8f9fa, #fbfbfb — one
 * cause, five groups by exact pair). The exemplar keeps the exact pair.
 */
function backgroundBand(hexColor: string): 'light' | 'mid-tone' | 'dark' {
  const rgb = [1, 3, 5].map(i => parseInt(hexColor.slice(i, i + 2), 16)) as [number, number, number]
  const l = relativeLuminance(rgb)
  return l > 0.6 ? 'light' : l < 0.15 ? 'dark' : 'mid-tone'
}

/** What two findings must share to be one group. */
export function groupKey(f: LintFinding): string {
  switch (f.rule) {
    case 'hairline':
      return `${f.kind} ${f.cssPx}px`
    case 'thin-text':
      return `${f.fontWeight} at ${f.fontSizePx}px`
    case 'contrast':
    case 'contrast-on-panel':
      return `${f.color} on ${backgroundBand(f.background)} backgrounds${f.largeText ? ' (large text)' : ''}`
    case 'image-upscaled':
    case 'image-oversized':
      // Not the asset's size: thirty images of thirty sizes are one cause.
      return `${f.srcset ? 'srcset' : 'no srcset'} · ${factorBucket(f.rule, f.factor)}`
  }
}

/**
 * Groups findings by rule and `groupKey`, in the order they arrive (rule
 * order, worst first), so a group's exemplar is its worst member. Over every
 * finding, not the listed cap: a page with 270 identical contrast failures
 * is one group with count 270.
 *
 * One exception to "worst member": the exemplar exists to be *shown* — the
 * report crops it and pins it on the full-page overview — and a rect inside a
 * panel with its own scrollbar is nowhere on that page (see `AuditRect`).
 * A group whose worst member happens to sit in a sidebar would lose its pin
 * for every member, so the first member that can be located takes over. A
 * group with nothing but clipped members keeps its worst one and is reported
 * as a panel finding.
 */
export function groupFindings(findings: LintFinding[]): LintGroup[] {
  const groups = new Map<string, LintGroup>()
  for (const f of findings) {
    const key = groupKey(f)
    const id = `${f.rule}|${key}`
    const g = groups.get(id)
    if (g) {
      g.count++
      if (g.exemplar.rect.clipped && !f.rect.clipped) g.exemplar = f
      if (g.elements.length < LINT_GROUP_ELEMENTS && !g.elements.includes(f.element)) g.elements.push(f.element)
    } else if (groups.size < LINT_MAX_GROUPS) {
      groups.set(id, { rule: f.rule, key, count: 1, exemplar: f, elements: [f.element] })
    }
  }
  return [...groups.values()]
}

export interface LintResult {
  profile: string
  /**
   * How much smaller the page is drawn than it is laid out (`shared/layoutScale`):
   * 1 for a page that fits its screen, 360/980 for one with no viewport meta
   * on a 360 px phone. Every device-pixel figure is of the page as drawn; the
   * rects are in the page's own layout px, which are 1/scale times larger.
   */
  layoutScale: number
  thresholds: LintThresholds
  /** Every finding counted, listed or not. */
  summary: Record<LintRule, number>
  findings: LintFinding[]
  /** The same findings grouped by what they share, over every one counted; see `groupFindings`. */
  groups: LintGroup[]
  /**
   * Text that got no contrast verdict: over an image or gradient (no colour to
   * measure), or the same colour as its background (hidden by design, or broken).
   */
  skipped: { textOnImages: number; invisibleText: number; spacers: number }
  truncated: { findings: number; text: number; edges: number; images: number }
  warnings: string[]
}

const round = (v: number, places: number): number => {
  const k = 10 ** places
  return Math.round(v * k) / k
}

/** WCAG's large text: 24px, or 18.66px at bold; the 3:1 threshold applies there. */
export function isLargeText(fontSizePx: number, fontWeight: number): boolean {
  return fontSizePx >= 24 || (fontSizePx >= 18.66 && fontWeight >= 700)
}

const isVector = (src: string): boolean => /\.svg(?:[?#]|$)/i.test(src) || /^data:image\/svg/i.test(src)

export function lintFindings(report: LintReport, screen: LintScreen, panel: LintPanel, thresholds: LintThresholds): LintResult {
  const warnings: string[] = []
  // Device pixels per CSS pixel of the page: the density, the reflow zoom on
  // top of it, and the fit-to-width scale of a page laid out wider than the
  // screen (no viewport meta on a phone), which draws every page px smaller.
  const textScale = screen.textScale ?? 1
  const scale = layoutScale(screen.cssWidth, textScale, report.viewport.width)
  const scaleNote = layoutScaleNote(scale, report.viewport.width, screen.cssWidth / textScale)
  if (scaleNote) warnings.push(scaleNote)
  const k = screen.deviceScaleFactor * textScale * scale
  const summary: Record<LintRule, number> = { hairline: 0, 'thin-text': 0, contrast: 0, 'contrast-on-panel': 0, 'image-upscaled': 0, 'image-oversized': 0 }
  const groups: Record<LintRule, LintFinding[]> = { hairline: [], 'thin-text': [], contrast: [], 'contrast-on-panel': [], 'image-upscaled': [], 'image-oversized': [] }

  for (const e of report.edges) {
    const devicePx = e.px * k
    if (devicePx >= 1) continue
    groups.hairline.push({
      rule: 'hairline',
      element: e.element,
      text: e.text,
      rect: e.rect,
      kind: e.kind,
      cssPx: round(e.px, 3),
      devicePx: round(devicePx, 2),
      message:
        `${e.kind} ${round(e.px, 3)}px is ${round(devicePx, 2)} of a device pixel on this screen: ` +
        `drawn as a whole pixel, faint, or not at all, depending on where it lands`,
    })
  }
  groups.hairline.sort((a, b) => (a.rule === 'hairline' && b.rule === 'hairline' ? a.devicePx - b.devicePx : 0))

  let textOnImages = 0
  let invisibleText = 0
  for (const t of report.text) {
    const devicePx = t.fontSizePx * k
    if (t.fontWeight < 400 && devicePx < thresholds.thinPx) {
      groups['thin-text'].push({
        rule: 'thin-text',
        element: t.element,
        text: t.text,
        rect: t.rect,
        fontSizePx: t.fontSizePx,
        fontWeight: t.fontWeight,
        devicePx: round(devicePx, 1),
        message:
          `${t.fontWeight}-weight at ${t.fontSizePx}px is ${round(devicePx, 1)} device px tall on this screen: ` +
          `strokes thinner than a device pixel go grey and break up`,
      })
    }
    if (t.background === null) {
      textOnImages++
      continue
    }
    const c = effectiveContrast(t.color, t.background, panel.params, panel.vision?.matrix)
    const large = isLargeText(t.fontSizePx, t.fontWeight)
    const threshold = large ? 3 : 4.5
    const fg = hex(t.color)
    const bg = hex(t.background)
    // Text with no contrast at all is not failing a threshold: a reveal mask's
    // duplicate, a decorative shadow layer, or a bug. Counted, not judged.
    if (c.asIs < INVISIBLE_CONTRAST) {
      invisibleText++
      continue
    }
    if (c.asIs < threshold) {
      groups.contrast.push({
        rule: 'contrast',
        element: t.element,
        text: t.text,
        rect: t.rect,
        fontSizePx: t.fontSizePx,
        fontWeight: t.fontWeight,
        color: fg,
        background: bg,
        asIs: round(c.asIs, 2),
        onPanel: round(c.onPanel, 2),
        threshold,
        largeText: large,
        message: `${fg} on ${bg} is ${round(c.asIs, 2)}:1 as stated; WCAG AA asks ${threshold}:1 of text this size`,
      })
    } else if (c.onPanel < threshold) {
      groups['contrast-on-panel'].push({
        rule: 'contrast-on-panel',
        element: t.element,
        text: t.text,
        rect: t.rect,
        fontSizePx: t.fontSizePx,
        fontWeight: t.fontWeight,
        color: fg,
        background: bg,
        asIs: round(c.asIs, 2),
        onPanel: round(c.onPanel, 2),
        threshold,
        largeText: large,
        message:
          `${fg} on ${bg} is ${round(c.asIs, 2)}:1 as stated and ${round(c.onPanel, 2)}:1 on ${panel.profileLabel}` +
          `${panel.vision ? ` with ${panel.vision.label}` : ''}: passes on the display it was designed on, fails on this one`,
      })
    }
  }
  groups['thin-text'].sort((a, b) => (a.rule === 'thin-text' && b.rule === 'thin-text' ? a.devicePx - b.devicePx : 0))
  const byRatio = (a: LintFinding, b: LintFinding): number =>
    (a.rule === 'contrast' || a.rule === 'contrast-on-panel') && (b.rule === 'contrast' || b.rule === 'contrast-on-panel')
      ? a.rule === 'contrast'
        ? a.asIs - b.asIs
        : a.onPanel - b.onPanel
      : 0
  groups.contrast.sort(byRatio)
  groups['contrast-on-panel'].sort(byRatio)

  for (const img of report.images) {
    if (isVector(img.src)) continue
    const drawn = { width: Math.round(img.rect.width * k), height: Math.round(img.rect.height * k) }
    if (drawn.width <= 0 || drawn.height <= 0) continue
    const fit = img.objectFit ?? 'fill'
    const scale = imageScale({ width: img.naturalWidth, height: img.naturalHeight }, drawn, fit)
    // The most blurred axis decides an upscale, the most softened a downsample;
    // for the fits that keep the shape the two axes agree.
    const up = Math.max(scale.x, scale.y)
    const down = 1 / Math.min(scale.x, scale.y)
    const common = {
      element: img.element,
      text: '',
      rect: img.rect,
      naturalWidth: img.naturalWidth,
      naturalHeight: img.naturalHeight,
      drawnDevicePx: drawn,
      objectFit: fit,
      srcset: img.srcset,
      candidates: img.candidates,
      ...(img.chosen !== undefined ? { chosen: img.chosen } : {}),
      src: img.src,
    }
    // Which candidate the browser took, when the walk could tell: the reader
    // then knows whether the srcset lacks a larger one or `sizes` undersold
    // the slot.
    const file = `${img.naturalWidth}×${img.naturalHeight} px${img.chosen !== undefined ? ` (the ${img.chosen} candidate)` : ''}`
    const box = `${drawn.width}×${drawn.height} device px`
    // A fill of a box of another shape stretches: say which axis the factor
    // is on, since the other is scaled differently, and by how much.
    const stretched = fit === 'fill' && Math.abs(scale.x - scale.y) > 0.02 * Math.max(scale.x, scale.y)
    const axis = (v: number): string => (v === scale.y && scale.y !== scale.x ? 'height' : 'width')
    if (up > 1 / IMAGE_UPSCALED_TOLERANCE) {
      const factor = round(up, 2)
      const how =
        fit === 'cover'
          ? `covering ${box} (object-fit: cover)`
          : fit === 'contain'
            ? `fitted inside ${box} (object-fit: contain)`
            : stretched
              ? `stretched over ${box}`
              : `drawn over ${box}`
      const onAxis = stretched ? ` on its ${axis(up)} (${round(Math.min(scale.x, scale.y), 2)}× on its ${axis(Math.min(scale.x, scale.y))})` : ''
      groups['image-upscaled'].push({
        rule: 'image-upscaled',
        ...common,
        factor,
        message: `${file} ${how}: upscaled ${factor}×${onAxis}, so it is blurred on this screen${img.srcset ? '' : '; no srcset offers a larger candidate'}`,
      })
    } else if (down > IMAGE_OVERSIZED_FACTOR) {
      const factor = round(down, 2)
      const how =
        fit === 'cover'
          ? `covering ${box} (object-fit: cover)`
          : fit === 'contain' || fit === 'scale-down'
            ? `fitted inside ${box} (object-fit: ${fit})`
            : stretched
              ? `squeezed into ${box}`
              : `drawn at ${box}`
      const onAxis = stretched ? ` on its ${axis(1 / down)}` : ''
      groups['image-oversized'].push({
        rule: 'image-oversized',
        ...common,
        factor,
        message: `${file} ${how}: downsampled ${factor}×${onAxis}, which softens fine lines and text in it${img.srcset ? '' : '; no srcset offers a candidate near this size'}`,
      })
    }
  }
  const byFactor = (a: LintFinding, b: LintFinding): number =>
    (a.rule === 'image-upscaled' || a.rule === 'image-oversized') && (b.rule === 'image-upscaled' || b.rule === 'image-oversized')
      ? b.factor - a.factor
      : 0
  groups['image-upscaled'].sort(byFactor)
  groups['image-oversized'].sort(byFactor)

  const all: LintFinding[] = []
  for (const rule of LINT_RULES) {
    summary[rule] = groups[rule].length
    all.push(...groups[rule])
  }
  const findings = all.slice(0, LINT_MAX_FINDINGS)

  if (textOnImages > 0) {
    warnings.push(`${textOnImages} text element${textOnImages === 1 ? ' sits' : 's sit'} on an image or gradient and got no contrast verdict: the pixels under it are not a colour anyone stated`)
  }
  if (invisibleText > 0) {
    warnings.push(`${invisibleText} text element${invisibleText === 1 ? ' is' : 's are'} the same colour as the background (1:1): hidden by design or broken, not judged`)
  }
  const spacers = report.spacers ?? 0
  if (spacers > 0) {
    warnings.push(`${spacers} image${spacers === 1 ? ' is' : 's are'} a file of a pixel or two on a side stretched into a gap — a spacer, not a picture — and ${spacers === 1 ? 'was' : 'were'} not judged`)
  }
  const over = report.truncated
  if (over.text > 0 || over.edges > 0 || over.images > 0) {
    warnings.push(
      `the page has more elements than one report carries: ${over.text} text elements, ${over.edges} edges and ${over.images} images were counted but not measured`,
    )
  }
  // No sentence here about the capped list: `truncated.findings` carries the
  // count, and whoever prints the list says it (`listTruncationNote`).

  return {
    profile: panel.profileId,
    layoutScale: round(scale, 4),
    thresholds,
    summary,
    findings,
    groups: groupFindings(all),
    skipped: { textOnImages, invisibleText, spacers },
    truncated: { findings: all.length - findings.length, text: over.text, edges: over.edges, images: over.images },
    warnings,
  }
}
