import type { AuditRect, AuditReport } from '../shared/audit'
import { ppi as ppiOf } from '../shared/calibration'
import { cssPxToMm } from '../shared/contrast'

/**
 * The physical-units audit: what on this page is too small *on this screen*,
 * in millimetres. A 24 CSS px control is 6.6 mm on a 24" 1080p and 4.5 mm on
 * a 6.5" phone; a CSS-pixel rule cannot say which of those a thumb can hit.
 * Pure — no Electron, no I/O — and unit-tested under plain node.
 *
 * The thresholds are provisional and exposed as flags. Tap targets: Apple's
 * 44pt is 6.9 mm on a 163 ppi screen and WCAG 2.5.8's 24 CSS px is the legal
 * floor; 7 mm sits between them. Text: no standard states a floor in
 * millimetres; 2 mm is roughly 11px on a phone and 7px on a 1080p monitor,
 * below which body text is unreadable and captions are guesswork at arm's
 * length. Both were checked against real pages (docs/audit.md has the
 * table) and may move when better evidence turns up — which is why the
 * output states the values used.
 */

export const DEFAULT_TAP_MM = 7
export const DEFAULT_TEXT_MM = 2
/** Findings past this are counted, not listed; the smallest come first. */
export const MAX_FINDINGS = 200

export interface AuditThresholds {
  tapMm: number
  textMm: number
}

export interface AuditScreen {
  cssWidth: number
  cssHeight: number
  deviceScaleFactor: number
  /** Null for a custom screen with no `--diagonal`: no density, no millimetres. */
  diagonalInches: number | null
  /**
   * Browser zoom as reflow, 1 (or absent) = none. The page's CSS px are this
   * many times the screen's, so a 24 px target at ×1.5 covers 36 device px
   * on a 1x screen and is measured as such; the density is the screen's.
   */
  textScale?: number
}

export type AuditFinding =
  | {
      kind: 'small-target'
      element: string
      text: string
      rect: AuditRect
      cssWidth: number
      cssHeight: number
      /** The shorter side, which is what a finger has to land inside. */
      mm: number
    }
  | { kind: 'small-text'; element: string; text: string; rect: AuditRect; fontSizePx: number; mm: number }

export interface AuditGroupSummary {
  count: number
  /** Below the threshold. Null when there is no density to measure with. */
  under: number | null
  smallestPx: number | null
  smallestMm: number | null
}

export interface AuditResult {
  /** Device pixels per inch of the screen, or null without a diagonal. */
  ppi: number | null
  thresholds: AuditThresholds
  summary: { targets: AuditGroupSummary; text: AuditGroupSummary }
  findings: AuditFinding[]
  truncated: { findings: number; targets: number; text: number }
  warnings: string[]
}

const round = (v: number, places: number): number => {
  const k = 10 ** places
  return Math.round(v * k) / k
}

export function auditFindings(report: AuditReport, screen: AuditScreen, thresholds: AuditThresholds): AuditResult {
  const warnings: string[] = []
  const ppi =
    screen.diagonalInches !== null && screen.diagonalInches > 0
      ? ppiOf(screen.cssWidth * screen.deviceScaleFactor, screen.cssHeight * screen.deviceScaleFactor, screen.diagonalInches)
      : null
  if (ppi === null) {
    warnings.push('no screen diagonal, so no millimetres: pass --diagonal <inches> with custom dimensions, or use a preset')
  }
  const mm = (px: number): number | null => (ppi === null ? null : cssPxToMm(px, screen.deviceScaleFactor * (screen.textScale ?? 1), ppi))

  const findings: AuditFinding[] = []
  let smallestTargetPx: number | null = null
  let underTargets = 0
  for (const t of report.targets) {
    const side = Math.min(t.rect.width, t.rect.height)
    smallestTargetPx = smallestTargetPx === null ? side : Math.min(smallestTargetPx, side)
    const sideMm = mm(side)
    if (sideMm === null) continue
    if (sideMm < thresholds.tapMm) {
      underTargets++
      findings.push({
        kind: 'small-target',
        element: t.element,
        text: t.text,
        rect: t.rect,
        cssWidth: round(t.rect.width, 1),
        cssHeight: round(t.rect.height, 1),
        mm: round(sideMm, 2),
      })
    }
  }

  let smallestTextPx: number | null = null
  let underText = 0
  for (const t of report.text) {
    smallestTextPx = smallestTextPx === null ? t.fontSizePx : Math.min(smallestTextPx, t.fontSizePx)
    const sizeMm = mm(t.fontSizePx)
    if (sizeMm === null) continue
    if (sizeMm < thresholds.textMm) {
      underText++
      findings.push({ kind: 'small-text', element: t.element, text: t.text, rect: t.rect, fontSizePx: t.fontSizePx, mm: round(sizeMm, 2) })
    }
  }

  findings.sort((a, b) => a.mm - b.mm)
  const listed = findings.slice(0, MAX_FINDINGS)

  const group = (count: number, under: number, smallestPx: number | null): AuditGroupSummary => ({
    count,
    under: ppi === null ? null : under,
    smallestPx: smallestPx === null ? null : round(smallestPx, 1),
    smallestMm: smallestPx === null || ppi === null ? null : round(mm(smallestPx)!, 2),
  })

  if (report.truncated.targets > 0 || report.truncated.text > 0) {
    warnings.push(
      `the page has more elements than one report carries: ${report.truncated.targets} targets and ${report.truncated.text} text elements were counted but not measured`,
    )
  }

  return {
    ppi: ppi === null ? null : round(ppi, 1),
    thresholds,
    summary: {
      targets: group(report.targets.length, underTargets, smallestTargetPx),
      text: group(report.text.length, underText, smallestTextPx),
    },
    findings: listed,
    truncated: { findings: findings.length - listed.length, targets: report.truncated.targets, text: report.truncated.text },
    warnings,
  }
}
