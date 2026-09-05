import { describe, expect, it } from 'vitest'
import { DEFAULT_THIN_PX, LINT_MAX_FINDINGS, LINT_RULES, isLargeText, lintFindings, type LintPanel } from '../../src/cli/lint'
import { effectiveContrast } from '../../src/shared/contrast'
import type { LintEdge, LintImage, LintReport, LintText } from '../../src/shared/lint'
import { profileToParams } from '../../src/shared/panelSim'
import { DEFAULT_SETTINGS, findProfile } from '../../src/shared/presets'

const rect = { x: 10, y: 20, width: 300, height: 40 }
const report = (parts: Partial<LintReport>): LintReport => ({
  viewport: { width: 1920, height: 1080 },
  pageHeight: 2000,
  text: [],
  edges: [],
  images: [],
  truncated: { text: 0, edges: 0, images: 0 },
  ...parts,
})
const text = (parts: Partial<LintText>): LintText => ({
  element: 'p#t',
  text: 'some text',
  rect,
  fontSizePx: 16,
  fontWeight: 400,
  fontFamily: 'Arial',
  color: [0, 0, 0, 1],
  background: [255, 255, 255, 1],
  backgroundNote: 'computed',
  ...parts,
})
const edge = (parts: Partial<LintEdge>): LintEdge => ({ element: 'div#e', text: '', rect, kind: 'border-top', px: 0.5, ...parts })
const image = (parts: Partial<LintImage>): LintImage => ({
  element: 'img#i',
  rect: { x: 0, y: 0, width: 200, height: 200 },
  naturalWidth: 200,
  naturalHeight: 200,
  src: 'https://x.test/a.png',
  srcset: false,
  candidates: [],
  ...parts,
})
const panel = (id: string): LintPanel => {
  const p = findProfile(id)
  return { profileId: p.id, profileLabel: p.label, params: profileToParams(p, DEFAULT_SETTINGS.hostNits) }
}
const reference = panel('reference')
const budget = panel('budget-tn')
const screen = (deviceScaleFactor: number, textScale?: number) => ({ cssWidth: 1920, cssHeight: 1080, deviceScaleFactor, ...(textScale !== undefined ? { textScale } : {}) })
const thresholds = { thinPx: DEFAULT_THIN_PX }

describe('hairline', () => {
  it('a 0.5px border is half a device pixel on a 1x screen, and a whole one at 2x', () => {
    const r = report({ edges: [edge({ px: 0.5 })] })
    const at1x = lintFindings(r, screen(1), reference, thresholds)
    expect(at1x.summary.hairline).toBe(1)
    expect(at1x.findings[0]).toMatchObject({ rule: 'hairline', kind: 'border-top', cssPx: 0.5, devicePx: 0.5, element: 'div#e' })
    expect(at1x.findings[0]!.message).toContain('0.5 of a device pixel')
    expect(lintFindings(r, screen(2), reference, thresholds).summary.hairline).toBe(0)
  })
  it('text scale multiplies the density: 0.5px at ×1.5 on 1x is 0.75, still under; at ×2 it is whole', () => {
    const r = report({ edges: [edge({ px: 0.5 })] })
    expect(lintFindings(r, screen(1, 1.5), reference, thresholds).findings[0]).toMatchObject({ devicePx: 0.75 })
    expect(lintFindings(r, screen(1, 2), reference, thresholds).summary.hairline).toBe(0)
  })
  it('thinnest first', () => {
    const r = report({ edges: [edge({ px: 0.75, element: 'a' }), edge({ px: 0.25, element: 'b', kind: 'height' }), edge({ px: 0.5, element: 'c', kind: 'box-shadow' })] })
    expect(lintFindings(r, screen(1), reference, thresholds).findings.map(f => f.element)).toEqual(['b', 'c', 'a'])
  })
})

describe('thin text', () => {
  it('300 at 12px on a 1x screen is flagged; the same on a 2x screen is 24 device px and fine', () => {
    const r = report({ text: [text({ fontWeight: 300, fontSizePx: 12 })] })
    const at1x = lintFindings(r, screen(1), reference, thresholds)
    expect(at1x.summary['thin-text']).toBe(1)
    expect(at1x.findings[0]).toMatchObject({ rule: 'thin-text', fontWeight: 300, fontSizePx: 12, devicePx: 12 })
    expect(lintFindings(r, screen(2), reference, thresholds).summary['thin-text']).toBe(0)
  })
  it('regular weight is never thin; the threshold is the caller\'s', () => {
    expect(lintFindings(report({ text: [text({ fontWeight: 400, fontSizePx: 9 })] }), screen(1), reference, thresholds).summary['thin-text']).toBe(0)
    expect(lintFindings(report({ text: [text({ fontWeight: 300, fontSizePx: 12 })] }), screen(1), reference, { thinPx: 10 }).summary['thin-text']).toBe(0)
  })
})

describe('contrast', () => {
  it('a pair under WCAG as stated is a contrast finding, with the threshold for its size', () => {
    const r = report({ text: [text({ color: [153, 153, 153, 1] })] })
    const res = lintFindings(r, screen(1), reference, thresholds)
    expect(res.summary.contrast).toBe(1)
    expect(res.findings[0]).toMatchObject({ rule: 'contrast', color: '#999999', background: '#ffffff', threshold: 4.5, largeText: false })
    expect((res.findings[0] as { asIs: number }).asIs).toBeCloseTo(2.85, 1)
  })
  it('large text is judged at 3:1', () => {
    expect(isLargeText(24, 400)).toBe(true)
    expect(isLargeText(18.66, 700)).toBe(true)
    expect(isLargeText(18.66, 400)).toBe(false)
    const r = report({ text: [text({ color: [118, 118, 118, 1], fontSizePx: 32 })] })
    expect(lintFindings(r, screen(1), reference, thresholds).summary.contrast).toBe(0)
  })
  it('a pair that passes as stated but not on the panel is a contrast-on-panel finding, and none on the reference panel', () => {
    // #767676 on white: 4.54:1, just over. The budget TN lifts the blacks
    // and pulls the pair together — the test says by how much.
    const colour: [number, number, number, number] = [118, 118, 118, 1]
    const onBudget = effectiveContrast(colour, [255, 255, 255, 1], budget.params)
    expect(onBudget.asIs).toBeGreaterThanOrEqual(4.5)
    expect(onBudget.onPanel).toBeLessThan(4.5)
    const r = report({ text: [text({ color: colour })] })
    expect(lintFindings(r, screen(1), reference, thresholds).summary['contrast-on-panel']).toBe(0)
    const res = lintFindings(r, screen(1), budget, thresholds)
    expect(res.summary['contrast-on-panel']).toBe(1)
    expect(res.summary.contrast).toBe(0)
    expect(res.findings[0]).toMatchObject({ rule: 'contrast-on-panel', color: '#767676', threshold: 4.5 })
    expect(res.findings[0]!.message).toContain('on Budget TN')
    expect(res.profile).toBe('budget-tn')
  })
  it('text over an image gets no verdict, and the result says how many', () => {
    const r = report({ text: [text({ background: null, backgroundNote: 'image', color: [153, 153, 153, 1] })] })
    const res = lintFindings(r, screen(1), reference, thresholds)
    expect(res.summary.contrast).toBe(0)
    expect(res.skipped.textOnImages).toBe(1)
    expect(res.warnings[0]).toMatch(/1 text element sits on an image/)
  })
})

describe('images', () => {
  it('drawn wider than it is: upscaled by the factor, more so on a denser screen', () => {
    const r = report({ images: [image({ naturalWidth: 100, naturalHeight: 100 })] })
    const at1x = lintFindings(r, screen(1), reference, thresholds)
    expect(at1x.findings[0]).toMatchObject({ rule: 'image-upscaled', factor: 2, drawnDevicePx: { width: 200, height: 200 } })
    expect(at1x.findings[0]!.message).toContain('no srcset offers a larger candidate')
    expect(lintFindings(r, screen(2), reference, thresholds).findings[0]).toMatchObject({ factor: 4 })
  })
  it('far larger than drawn: oversized, with the srcset noted', () => {
    const r = report({ images: [image({ naturalWidth: 1000, naturalHeight: 1000, srcset: true, candidates: ['2x', '3x'] })] })
    const res = lintFindings(r, screen(1), reference, thresholds)
    expect(res.findings[0]).toMatchObject({ rule: 'image-oversized', factor: 5, candidates: ['2x', '3x'] })
    expect(res.findings[0]!.message).not.toContain('no srcset')
  })
  it('a fit at 1x is a 2× upscale on a phone; vectors are never judged', () => {
    const r = report({ images: [image({ naturalWidth: 200, naturalHeight: 200 }), image({ element: 'img#v', src: 'https://x.test/logo.svg', naturalWidth: 10, naturalHeight: 10 })] })
    expect(lintFindings(r, screen(1), reference, thresholds).summary['image-upscaled']).toBe(0)
    const phone = lintFindings(r, screen(2), reference, thresholds)
    expect(phone.summary['image-upscaled']).toBe(1)
    expect(phone.findings[0]!.element).toBe('img#i')
  })
})

describe('the list', () => {
  it('rules in a fixed order, the summary counts everything, the list is capped', () => {
    const edges = Array.from({ length: LINT_MAX_FINDINGS + 30 }, (_, i) => edge({ element: `div#e${i}`, px: 0.5 }))
    const r = report({ edges, text: [text({ fontWeight: 300, fontSizePx: 12 })], images: [image({ naturalWidth: 100, naturalHeight: 100 })] })
    const res = lintFindings(r, screen(1), reference, thresholds)
    expect(res.summary).toEqual({ hairline: LINT_MAX_FINDINGS + 30, 'thin-text': 1, contrast: 0, 'contrast-on-panel': 0, 'image-upscaled': 1, 'image-oversized': 0 })
    expect(res.findings).toHaveLength(LINT_MAX_FINDINGS)
    expect(res.findings.every(f => f.rule === 'hairline')).toBe(true)
    expect(res.truncated.findings).toBe(32)
    expect(res.warnings.at(-1)).toMatch(/32 more findings past the 200 listed/)
    expect(LINT_RULES).toEqual(['hairline', 'thin-text', 'contrast', 'contrast-on-panel', 'image-upscaled', 'image-oversized'])
  })
  it('a page past the walk\'s caps is said so', () => {
    const res = lintFindings(report({ truncated: { text: 3, edges: 0, images: 1 } }), screen(1), reference, thresholds)
    expect(res.truncated).toEqual({ findings: 0, text: 3, edges: 0, images: 1 })
    expect(res.warnings[0]).toMatch(/3 text elements, 0 edges and 1 images/)
  })
})
