import { describe, expect, it } from 'vitest'
import { DEFAULT_TAP_MM, DEFAULT_TEXT_MM, MAX_FINDINGS, auditFindings, type AuditScreen } from '../../src/cli/audit'
import type { AuditReport } from '../../src/shared/audit'
import { findPreset } from '../../src/shared/presets'

const screenOf = (id: string): AuditScreen => {
  const p = findPreset(id)
  return { cssWidth: p.width, cssHeight: p.height, deviceScaleFactor: p.deviceScaleFactor, diagonalInches: p.diagonalInches }
}
const rect = (width: number, height: number) => ({ x: 0, y: 0, width, height })
const thresholds = { tapMm: DEFAULT_TAP_MM, textMm: DEFAULT_TEXT_MM }

const report: AuditReport = {
  viewport: { width: 1920, height: 1080 },
  pageHeight: 1080,
  targets: [
    { element: 'button#big', text: 'A generous button', rect: rect(200, 48) },
    { element: 'button#tiny', text: 'Close', rect: rect(24, 24) },
  ],
  text: [
    { element: 'p#body', text: 'Body text', fontSizePx: 16, rect: rect(600, 20) },
    { element: 'p#caption', text: 'A caption', fontSizePx: 10, rect: rect(600, 12) },
  ],
  truncated: { targets: 0, text: 0 },
}

describe('auditFindings', () => {
  it('a 24px control is under 7 mm on a 24" 1080p; a 10px caption is not under 2 mm there', () => {
    const r = auditFindings(report, screenOf('1080p-24'), thresholds)
    expect(r.ppi).toBeCloseTo(91.8, 1)
    expect(r.findings.map(f => f.kind + ' ' + f.element)).toEqual(['small-target button#tiny'])
    const f = r.findings[0]!
    expect(f.kind === 'small-target' && f.mm).toBeCloseTo(6.64, 1)
    expect(r.summary.targets).toEqual({ count: 2, under: 1, smallestPx: 24, smallestMm: 6.64 })
    expect(r.summary.text.under).toBe(0)
    expect(r.summary.text.smallestMm).toBeCloseTo(2.77, 1)
  })
  it('on a 6.5" phone at 2x the same page has both findings, smallest first', () => {
    const r = auditFindings(report, screenOf('android-65'), thresholds)
    expect(r.ppi).toBeCloseTo(269.8, 0)
    expect(r.findings.map(f => f.kind)).toEqual(['small-text', 'small-target'])
    expect(r.findings[0]!.mm).toBeCloseTo(1.88, 1)
    expect(r.findings[1]!.mm).toBeCloseTo(4.52, 1)
  })
  it('thresholds are the caller\'s: at 4 mm the 24px control passes', () => {
    const r = auditFindings(report, screenOf('android-65'), { tapMm: 4, textMm: 1 })
    expect(r.findings).toEqual([])
    expect(r.thresholds).toEqual({ tapMm: 4, textMm: 1 })
  })
  it('without a diagonal there are no millimetres, and it says so', () => {
    const r = auditFindings(report, { cssWidth: 1366, cssHeight: 768, deviceScaleFactor: 1, diagonalInches: null }, thresholds)
    expect(r.ppi).toBeNull()
    expect(r.findings).toEqual([])
    expect(r.summary.targets).toEqual({ count: 2, under: null, smallestPx: 24, smallestMm: null })
    expect(r.warnings[0]).toMatch(/--diagonal/)
  })
  it('lists at most MAX_FINDINGS, smallest first, and counts the rest', () => {
    const many: AuditReport = {
      ...report,
      targets: Array.from({ length: MAX_FINDINGS + 50 }, (_, i) => ({ element: `a#n${i}`, text: '', rect: rect(10 + i * 0.01, 10) })),
      text: [],
    }
    const r = auditFindings(many, screenOf('android-65'), thresholds)
    expect(r.findings).toHaveLength(MAX_FINDINGS)
    expect(r.truncated.findings).toBe(50)
    expect(r.findings[0]!.element).toBe('a#n0')
    expect(r.summary.targets.under).toBe(MAX_FINDINGS + 50)
  })
  it('carries the page\'s own truncation through as a warning', () => {
    const r = auditFindings({ ...report, truncated: { targets: 3, text: 0 } }, screenOf('1080p-24'), thresholds)
    expect(r.truncated.targets).toBe(3)
    expect(r.warnings.join(' ')).toMatch(/3 targets/)
  })
})

describe('auditFindings under a text scale', () => {
  it('×1.5 on the 24" 1080p: the 24px control is 9.96 mm and no longer small; nothing else changes', () => {
    const r = auditFindings(report, { ...screenOf('1080p-24'), textScale: 1.5 }, thresholds)
    expect(r.ppi).toBeCloseTo(91.8, 1)
    expect(r.findings).toEqual([])
    expect(r.summary.targets).toEqual({ count: 2, under: 0, smallestPx: 24, smallestMm: 9.96 })
    expect(r.summary.text.smallestMm).toBeCloseTo(4.15, 1)
  })
  it('absent means ×1', () => {
    expect(auditFindings(report, screenOf('1080p-24'), thresholds)).toEqual(
      auditFindings(report, { ...screenOf('1080p-24'), textScale: 1 }, thresholds),
    )
  })
})

describe('audit groups', () => {
  const rect = { x: 0, y: 0, width: 40, height: 22 }
  it('targets of one size are one group with a count; the exemplar is the smallest member', () => {
    const report = {
      viewport: { width: 1920, height: 1080 },
      pageHeight: 2000,
      targets: ['a', 'b', 'c', 'd'].map((id, i) => ({ element: `a#${id}`, text: id, rect: { ...rect, width: 40 + i } })),
      text: [{ element: 'p#cap', text: 'caption', fontSizePx: 10, rect }, { element: 'p#cap2', text: 'caption', fontSizePx: 10, rect }],
      truncated: { targets: 0, text: 0 },
    }
    const res = auditFindings(report, { cssWidth: 360, cssHeight: 800, deviceScaleFactor: 2, diagonalInches: 6.5 }, { tapMm: 7, textMm: 2 })
    expect(res.findings.length).toBeGreaterThanOrEqual(5)
    const targets = res.groups.filter(g => g.kind === 'small-target')
    // Widths 40..43 by height 22: the shorter side is 22 for all, but the CSS box differs per width, so four boxes.
    expect(targets.map(g => g.key)).toEqual(['40×22 px', '41×22 px', '42×22 px', '43×22 px'])
    const text = res.groups.find(g => g.kind === 'small-text')!
    expect(text).toMatchObject({ key: '10 px', count: 2, elements: ['p#cap', 'p#cap2'] })
    expect(text.exemplar.element).toBe('p#cap')
  })
  it('groups run over every finding counted, not the listed cap', () => {
    const many = Array.from({ length: 250 }, (_, i) => ({ element: `a#l${i}`, text: 'link', rect: { x: 0, y: i * 30, width: 40, height: 22 } }))
    const res = auditFindings(
      { viewport: { width: 360, height: 800 }, pageHeight: 8000, targets: many, text: [], truncated: { targets: 0, text: 0 } },
      { cssWidth: 360, cssHeight: 800, deviceScaleFactor: 2, diagonalInches: 6.5 },
      { tapMm: 7, textMm: 2 },
    )
    expect(res.findings).toHaveLength(200)
    expect(res.groups).toEqual([expect.objectContaining({ kind: 'small-target', key: '40×22 px', count: 250 })])
    expect(res.groups[0]!.elements).toHaveLength(5)
  })
})
