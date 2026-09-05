import { effectiveContrast, hex } from '../shared/contrast'
import type { LintEdgeKind, LintRect, LintReport } from '../shared/lint'
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
/** Findings past this are counted, not listed; the worst come first. */
export const LINT_MAX_FINDINGS = 200

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
      naturalHeight: number
      drawnDevicePx: { width: number; height: number }
      factor: number
      srcset: boolean
      candidates: string[]
      src: string
    })

/** Findings that share a cause, counted together; the list caps at 200, the groups do not. */
export interface LintGroup {
  rule: LintRule
  /** What the members share: a colour pair, a weight and size, an edge kind and thickness, an image's natural size. */
  key: string
  count: number
  /** The worst member, as listed: first in the rule's worst-first order. */
  exemplar: LintFinding
  /** Up to a few distinct elements, for the reader. */
  elements: string[]
}
/** Groups are few by nature; this bounds a pathological page. */
export const LINT_MAX_GROUPS = 100
export const LINT_GROUP_ELEMENTS = 5

/** What two findings must share to be one group. */
export function groupKey(f: LintFinding): string {
  switch (f.rule) {
    case 'hairline':
      return `${f.kind} ${f.cssPx}px`
    case 'thin-text':
      return `${f.fontWeight} at ${f.fontSizePx}px`
    case 'contrast':
    case 'contrast-on-panel':
      return `${f.color} on ${f.background}${f.largeText ? ' (large text)' : ''}`
    case 'image-upscaled':
    case 'image-oversized':
      return `${f.naturalWidth}×${f.naturalHeight} px`
  }
}

/**
 * Groups findings by rule and `groupKey`, in the order they arrive (rule
 * order, worst first), so a group's exemplar is its worst member. Over every
 * finding, not the listed cap: a page with 270 identical contrast failures
 * is one group with count 270.
 */
export function groupFindings(findings: LintFinding[]): LintGroup[] {
  const groups = new Map<string, LintGroup>()
  for (const f of findings) {
    const key = groupKey(f)
    const id = `${f.rule}|${key}`
    const g = groups.get(id)
    if (g) {
      g.count++
      if (g.elements.length < LINT_GROUP_ELEMENTS && !g.elements.includes(f.element)) g.elements.push(f.element)
    } else if (groups.size < LINT_MAX_GROUPS) {
      groups.set(id, { rule: f.rule, key, count: 1, exemplar: f, elements: [f.element] })
    }
  }
  return [...groups.values()]
}

export interface LintResult {
  profile: string
  thresholds: LintThresholds
  /** Every finding counted, listed or not. */
  summary: Record<LintRule, number>
  findings: LintFinding[]
  /** The same findings grouped by what they share, over every one counted; see `groupFindings`. */
  groups: LintGroup[]
  /** Text over an image or gradient: no colour to measure, so no contrast verdict. */
  skipped: { textOnImages: number }
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
  // Device pixels per CSS pixel of the page: the density, and the reflow zoom on top of it.
  const k = screen.deviceScaleFactor * (screen.textScale ?? 1)
  const summary: Record<LintRule, number> = { hairline: 0, 'thin-text': 0, contrast: 0, 'contrast-on-panel': 0, 'image-upscaled': 0, 'image-oversized': 0 }
  const groups: Record<LintRule, LintFinding[]> = { hairline: [], 'thin-text': [], contrast: [], 'contrast-on-panel': [], 'image-upscaled': [], 'image-oversized': [] }
  const warnings: string[] = []

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
    const ratio = img.naturalWidth / drawn.width
    const common = {
      element: img.element,
      text: '',
      rect: img.rect,
      naturalWidth: img.naturalWidth,
      naturalHeight: img.naturalHeight,
      drawnDevicePx: drawn,
      srcset: img.srcset,
      candidates: img.candidates,
      src: img.src,
    }
    if (ratio < IMAGE_UPSCALED_TOLERANCE) {
      const factor = round(1 / ratio, 2)
      groups['image-upscaled'].push({
        rule: 'image-upscaled',
        ...common,
        factor,
        message:
          `${img.naturalWidth}×${img.naturalHeight} px drawn over ${drawn.width}×${drawn.height} device px: upscaled ${factor}×, ` +
          `so it is blurred on this screen${img.srcset ? '' : '; no srcset offers a larger candidate'}`,
      })
    } else if (ratio > IMAGE_OVERSIZED_FACTOR) {
      const factor = round(ratio, 2)
      groups['image-oversized'].push({
        rule: 'image-oversized',
        ...common,
        factor,
        message:
          `${img.naturalWidth}×${img.naturalHeight} px drawn at ${drawn.width}×${drawn.height} device px: downsampled ${factor}×, ` +
          `which softens fine lines and text in it${img.srcset ? '' : '; no srcset offers a candidate near this size'}`,
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
  const over = report.truncated
  if (over.text > 0 || over.edges > 0 || over.images > 0) {
    warnings.push(
      `the page has more elements than one report carries: ${over.text} text elements, ${over.edges} edges and ${over.images} images were counted but not measured`,
    )
  }
  if (all.length > findings.length) {
    warnings.push(`${all.length - findings.length} more finding${all.length - findings.length === 1 ? '' : 's'} past the ${LINT_MAX_FINDINGS} listed; the summary counts them all`)
  }

  return {
    profile: panel.profileId,
    thresholds,
    summary,
    findings,
    groups: groupFindings(all),
    skipped: { textOnImages },
    truncated: { findings: all.length - findings.length, text: over.text, edges: over.edges, images: over.images },
    warnings,
  }
}
