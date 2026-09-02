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
