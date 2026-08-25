import { describe, it, expect } from 'vitest'
import { SCREEN_PRESETS, PANEL_PROFILES, findPreset, findProfile, MAX_VIEWPORT, DEFAULT_SETTINGS } from '../../src/shared/presets'

describe('presets', () => {
  it('has the fifteen screen presets: laptops, desktops, then mobiles', () => {
    expect(SCREEN_PRESETS.map(p => p.id)).toEqual([
      'laptop-768', 'laptop-768-14', 'laptop-768-11', 'laptop-800-11', 'laptop-900-17', 'laptop-1080-15',
      '1080p-24', '1080p-27', '1440p-27', 'sxga-19', '1440x900-19',
      'android-65', 'iphone-se', 'iphone-61', 'ipad-109',
    ])
    expect(findPreset('laptop-768')).toMatchObject({ width: 1366, height: 768, diagonalInches: 15.6, group: 'laptop' })
  })
  it('splits into laptop, desktop and mobile groups with no strays', () => {
    const groups = SCREEN_PRESETS.map(p => p.group)
    expect(groups.slice(0, 6)).toEqual(Array(6).fill('laptop'))
    expect(groups.slice(6, 11)).toEqual(Array(5).fill('desktop'))
    expect(groups.slice(11)).toEqual(Array(4).fill('mobile'))
  })
  it('every laptop and desktop preset rasterises at 1x', () => {
    for (const p of SCREEN_PRESETS.filter(p => p.group !== 'mobile')) {
      expect(p.deviceScaleFactor).toBe(1)
    }
  })
  it('mobile presets carry CSS viewports and real device scale factors', () => {
    expect(findPreset('android-65')).toMatchObject({ width: 360, height: 800, deviceScaleFactor: 2, diagonalInches: 6.5, group: 'mobile' })
    expect(findPreset('iphone-se')).toMatchObject({ width: 375, height: 667, deviceScaleFactor: 2, diagonalInches: 4.7, group: 'mobile' })
    expect(findPreset('iphone-61')).toMatchObject({ width: 393, height: 852, deviceScaleFactor: 3, diagonalInches: 6.1, group: 'mobile' })
    expect(findPreset('ipad-109')).toMatchObject({ width: 820, height: 1180, deviceScaleFactor: 2, diagonalInches: 10.9, group: 'mobile' })
  })
  it('mobile presets carry the intended device-pixel densities', () => {
    const devicePpi = (p: { width: number; height: number; diagonalInches: number; deviceScaleFactor: number }) =>
      Math.hypot(p.width * p.deviceScaleFactor, p.height * p.deviceScaleFactor) / p.diagonalInches
    expect(devicePpi(findPreset('android-65'))).toBeCloseTo(270.0, 0)
    expect(devicePpi(findPreset('iphone-se'))).toBeCloseTo(325.6, 1)
    expect(devicePpi(findPreset('iphone-61'))).toBeCloseTo(461.4, 1)
    expect(devicePpi(findPreset('ipad-109'))).toBeCloseTo(263.7, 1)
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
    expect(DEFAULT_SETTINGS).toEqual({ hostDiagonalInches: 27, hostNits: 500, agentControl: false })
  })
})
