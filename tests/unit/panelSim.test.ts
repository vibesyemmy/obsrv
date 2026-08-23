import { describe, it, expect } from 'vitest'
import { profileToParams, simulatePixel, bayer } from '../../src/shared/panelSim'
import { findProfile } from '../../src/shared/presets'

const reference = profileToParams(findProfile('reference'), 500)

describe('profileToParams', () => {
  it('maps reference profile to identity params', () => {
    expect(reference).toEqual({ brightness: 1, blackFloor: 0, gamut: 1, levels: 255, dither: false })
  })
  it('maps budget TN', () => {
    expect(profileToParams(findProfile('budget-tn'), 500)).toEqual({ brightness: 0.5, blackFloor: 1 / 700, gamut: 0.72, levels: 63, dither: true })
  })
  it('rejects non-positive host nits', () => {
    expect(() => profileToParams(findProfile('reference'), 0)).toThrow(RangeError)
  })
})

describe('bayer', () => {
  it('is a 4x4 ordered matrix in [0,1)', () => {
    expect(bayer(0, 0)).toBe(0)
    expect(bayer(1, 0)).toBe(8 / 16)
    expect(bayer(4, 4)).toBe(bayer(0, 0))
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) expect(bayer(x, y)).toBeLessThan(1)
  })
})

describe('simulatePixel', () => {
  it('is identity (±1) with reference params', () => {
    for (const px of [[0, 0, 0], [255, 255, 255], [128, 64, 32], [10, 200, 90]] as const) {
      const out = simulatePixel([px[0], px[1], px[2]], reference)
      out.forEach((v, i) => expect(Math.abs(v - px[i]!)).toBeLessThanOrEqual(1))
    }
  })
  it('lifts black to the contrast floor', () => {
    const p = { ...reference, blackFloor: 1 / 1000 }
    const [r] = simulatePixel([0, 0, 0], p)
    // linear 0.001 → encoded 0.001^(1/2.2) ≈ 0.0432 → 11/255
    expect(r).toBe(11)
  })
  it('gamut 0 collapses to grey', () => {
    const [r, g, b] = simulatePixel([255, 0, 0], { ...reference, gamut: 0 })
    expect(r).toBe(g)
    expect(g).toBe(b)
  })
  it('brightness scales linear light', () => {
    const [r] = simulatePixel([255, 255, 255], { ...reference, brightness: 0.5 })
    expect(r).toBe(Math.round(Math.pow(0.5, 1 / 2.2) * 255)) // 186
  })
  it('black floor scales with brightness (backlight leakage)', () => {
    const [r] = simulatePixel([0, 0, 0], { ...reference, brightness: 0.5, blackFloor: 1 / 1000 })
    expect(r).toBe(Math.round(Math.pow(0.0005, 1 / 2.2) * 255)) // 8
  })
  it('6-bit quantises to 63 levels', () => {
    const [r] = simulatePixel([100, 100, 100], { ...reference, levels: 63 })
    expect((r / 255) * 63).toBeCloseTo(Math.round((r / 255) * 63), 1)
  })
  it('dither varies output by pixel position', () => {
    const p = { ...reference, levels: 63, dither: true }
    const a = simulatePixel([100, 100, 100], p, 0, 0)[0]
    const b = simulatePixel([100, 100, 100], p, 1, 0)[0]
    expect(a).not.toBe(b)
  })
})
