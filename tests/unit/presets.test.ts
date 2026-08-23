import { describe, it, expect } from 'vitest'
import { SCREEN_PRESETS, PANEL_PROFILES, findPreset, findProfile, MAX_VIEWPORT, DEFAULT_SETTINGS } from '../../src/shared/presets'

describe('presets', () => {
  it('has the four screen presets from the spec', () => {
    expect(SCREEN_PRESETS.map(p => p.id)).toEqual(['1080p-24', '1080p-27', 'laptop-768', '1440p-27'])
    expect(findPreset('laptop-768')).toMatchObject({ width: 1366, height: 768, diagonalInches: 15.6 })
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
