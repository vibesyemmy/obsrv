import { describe, expect, it } from 'vitest'
import { ppi } from '../../src/shared/calibration'
import { contrastRatio, cssPxToMm, effectiveContrast, formatRatio, hex, onPanel, over, relativeLuminance } from '../../src/shared/contrast'
import { profileToParams } from '../../src/shared/panelSim'
import { findProfile } from '../../src/shared/presets'
import { visionMatrix } from '../../src/shared/vision'

describe('WCAG contrast', () => {
  it('white is 1, black is 0, and the pair is 21:1 either way round', () => {
    expect(relativeLuminance([255, 255, 255])).toBeCloseTo(1, 6)
    expect(relativeLuminance([0, 0, 0])).toBe(0)
    expect(contrastRatio([255, 255, 255], [0, 0, 0])).toBeCloseTo(21, 6)
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 6)
  })
  it('reproduces the published 4.54:1 of #767676 on white', () => {
    // The canonical "just passes AA" grey; every contrast checker quotes it.
    expect(contrastRatio([0x76, 0x76, 0x76], [255, 255, 255])).toBeCloseTo(4.54, 2)
  })
  it('composites a translucent colour before measuring', () => {
    const half = over([0, 0, 0, 0.5], [255, 255, 255])
    expect(half.map(Math.round)).toEqual([128, 128, 128])
    expect(over([10, 20, 30, 1], [255, 255, 255])).toEqual([10, 20, 30])
    expect(over([10, 20, 30, 0], [255, 255, 255])).toEqual([255, 255, 255])
  })
})

describe('contrast on a panel', () => {
  const reference = profileToParams(findProfile('reference'), 300)
  const budget = profileToParams(findProfile('budget-tn'), 300)

  it('the reference profile leaves a pair alone', () => {
    const c = effectiveContrast([0x6b, 0x72, 0x80, 1], [255, 255, 255, 1], reference)
    expect(c.onPanel).toBeCloseTo(c.asIs, 1)
  })
  it('a budget panel lowers it: the black floor lifts the dark colour', () => {
    const c = effectiveContrast([0x6b, 0x72, 0x80, 1], [255, 255, 255, 1], budget)
    expect(c.asIs).toBeGreaterThan(4.5)
    expect(c.onPanel).toBeLessThan(c.asIs)
    // Black on white is where the floor shows most: a 700:1 panel cannot
    // show 21:1, and the figure lands well under it.
    const bw = effectiveContrast([0, 0, 0, 1], [255, 255, 255, 1], budget)
    expect(bw.asIs).toBeCloseTo(21, 3)
    expect(bw.onPanel).toBeLessThan(18)
    expect(bw.onPanel).toBeGreaterThan(10)
  })
  it('measures without dithering, whatever the profile says', () => {
    // The same colour must give the same answer at any coordinate: a single
    // colour has no neighbours to dither with.
    const a = onPanel([120, 120, 120], budget)
    expect(onPanel([120, 120, 120], { ...budget, dither: true })).toEqual(a)
  })
  it('a viewer setting is applied, after the panel, to both colours', () => {
    const deutan = visionMatrix('deutan', 1)
    const plain = effectiveContrast([255, 0, 0, 1], [0, 128, 0, 1], budget)
    const seen = effectiveContrast([255, 0, 0, 1], [0, 128, 0, 1], budget, deutan)
    // The matrix changes the luminance of both colours, so the figure moves.
    // Which way is the model's business, not this test's: red on green goes
    // *up* under a deutan matrix, because the matrix brightens the red it
    // cannot distinguish. The claim held here is the pipeline order — the
    // same answer as running each colour through the panel with the matrix.
    expect(seen.onPanel).not.toBeCloseTo(plain.onPanel, 2)
    expect(seen.onPanel).toBeCloseTo(
      contrastRatio(onPanel([255, 0, 0], budget, deutan), onPanel([0, 128, 0], budget, deutan)),
      6,
    )
    expect(seen.asIs).toBe(plain.asIs)
  })
})

describe('physical size', () => {
  it('13px on a 24" 1080p is about 3.6 mm; the same CSS size on a 6.1" phone at 3x is about 2.2 mm', () => {
    expect(cssPxToMm(13, 1, ppi(1920, 1080, 24))).toBeCloseTo(3.6, 1)
    expect(cssPxToMm(13, 3, ppi(1179, 2556, 6.1))).toBeCloseTo(2.15, 1)
  })
  it('is NaN with no density to go on', () => {
    expect(cssPxToMm(13, 1, 0)).toBeNaN()
  })
})

describe('readout formatting', () => {
  it('hex and ratio', () => {
    expect(hex([107, 114, 128])).toBe('#6b7280')
    expect(hex([255, 255, 255, 1])).toBe('#ffffff')
    expect(formatRatio(4.8347)).toBe('4.8:1')
  })
})
