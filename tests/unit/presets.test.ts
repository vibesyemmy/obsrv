import { describe, it, expect } from 'vitest'
import { SCREEN_PRESETS, PANEL_PROFILES, findPreset, findProfile, MAX_VIEWPORT, DEFAULT_SETTINGS } from '../../src/shared/presets'

describe('presets', () => {
  it('has the eleven screen presets, laptops first', () => {
    expect(SCREEN_PRESETS.map(p => p.id)).toEqual([
      'laptop-768', 'laptop-768-14', 'laptop-768-11', 'laptop-800-11', 'laptop-900-17', 'laptop-1080-15',
      '1080p-24', '1080p-27', '1440p-27', 'sxga-19', '1440x900-19',
    ])
    expect(findPreset('laptop-768')).toMatchObject({ width: 1366, height: 768, diagonalInches: 15.6, group: 'laptop' })
  })
  it('splits into laptop and desktop groups with no strays', () => {
    const groups = SCREEN_PRESETS.map(p => p.group)
    expect(groups.slice(0, 6)).toEqual(Array(6).fill('laptop'))
    expect(groups.slice(6)).toEqual(Array(5).fill('desktop'))
  })
  it('new presets carry the intended pixel densities', () => {
    const ppi = (p: { width: number; height: number; diagonalInches: number }) =>
      Math.hypot(p.width, p.height) / p.diagonalInches
    expect(ppi(findPreset('laptop-768-14'))).toBeCloseTo(112.0, 0)
    expect(ppi(findPreset('laptop-768-11'))).toBeCloseTo(135.1, 1)
    expect(ppi(findPreset('laptop-800-11'))).toBeCloseTo(130.1, 1)
    expect(ppi(findPreset('laptop-900-17'))).toBeCloseTo(106.1, 1)
    expect(ppi(findPreset('laptop-1080-15'))).toBeCloseTo(141.2, 1)
    expect(ppi(findPreset('sxga-19'))).toBeCloseTo(86.3, 1)
    expect(ppi(findPreset('1440x900-19'))).toBeCloseTo(89.4, 1)
  })
  it('has the four panel profiles from the spec', () => {
    expect(PANEL_PROFILES.map(p => p.id)).toEqual(['reference', 'office-ips', 'budget-tn', 'old-laptop'])
    expect(findProfile('budget-tn')).toMatchObject({ contrastRatio: 700, gamutCoverage: 0.72, bits: 6, frc: true, nits: 250 })
    expect(findProfile('reference')).toMatchObject({ contrastRatio: null, gamutCoverage: 1, bits: 8, frc: false, nits: null })
  })
  it('throws on unknown ids', () => {
    expect(() => findPreset('nope')).toThrow(/unknown preset/)
    expect(() => findProfile('nope')).toThrow(/unknown profile/)
  })
  it('exposes limits and defaults', () => {
    expect(MAX_VIEWPORT).toBe(4096)
    expect(DEFAULT_SETTINGS).toEqual({ hostDiagonalInches: 27, hostNits: 500 })
  })
})
