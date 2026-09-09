import { describe, expect, it } from 'vitest'
import { layoutScale, layoutScaleNote } from '../../src/shared/layoutScale'

describe('layoutScale', () => {
  it('is 1 when the page fits the screen it was given', () => {
    expect(layoutScale(1366, 1, 1366)).toBe(1)
    expect(layoutScale(360, 1, 360)).toBe(1)
    expect(layoutScale(1920, 1, 1920)).toBe(1)
  })
  it('is the fit-to-width factor for a page laid out at the 980 px fallback (no viewport meta)', () => {
    expect(layoutScale(360, 1, 980)).toBeCloseTo(360 / 980, 6)
    expect(layoutScale(393, 1, 980)).toBeCloseTo(393 / 980, 6)
  })
  it('expects the layout viewport to be the screen over the text scale, and forgives the rounding', () => {
    // 1366 / 1.5 = 910.67; Chromium lays out at 911.
    expect(layoutScale(1366, 1.5, 911)).toBe(1)
    // A no-meta page under a text scale still lays out at 980.
    expect(layoutScale(360, 1.5, 980)).toBeCloseTo(240 / 980, 6)
  })
  it('says so in the other direction for a page drawn magnified', () => {
    expect(layoutScale(360, 1, 180)).toBe(2)
  })
  it('is 1 on any input it cannot use', () => {
    expect(layoutScale(0, 1, 980)).toBe(1)
    expect(layoutScale(360, 1, 0)).toBe(1)
    expect(layoutScale(360, 0, 360)).toBe(1)
    expect(layoutScale(NaN, 1, 980)).toBe(1)
    expect(layoutScale(360, 1, NaN)).toBe(1)
  })
})

describe('layoutScaleNote', () => {
  it('says nothing at 1', () => {
    expect(layoutScaleNote(1, 360, 360)).toBeNull()
  })
  it('names the widths, the factor and which figures are in which units', () => {
    const note = layoutScaleNote(360 / 980, 980, 360)
    expect(note).toContain('lays out 980 CSS px wide where the screen gives it 360')
    expect(note).toContain('drawn at 0.37× to fit')
    expect(note).toContain('no viewport meta tag')
    expect(note).toContain('2.72× larger than they are on the glass')
    expect(note).toContain('rects, font sizes and pageHeight are in its own layout px')
  })
  it('describes a magnified page without blaming a missing meta tag', () => {
    const note = layoutScaleNote(2, 180, 360)
    expect(note).toContain('drawn at 2.00×')
    expect(note).toContain('initial-scale above 1')
    expect(note).not.toContain('no viewport meta tag')
  })
})
