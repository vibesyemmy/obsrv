import { describe, it, expect } from 'vitest'
import { SCREEN_PRESETS, PANEL_PROFILES, findPreset, findProfile, MAX_VIEWPORT, DEFAULT_SETTINGS } from '../../src/shared/presets'

describe('presets', () => {
  it('has the twenty-two screen presets: laptops, desktops, then mobiles', () => {
    expect(SCREEN_PRESETS.map(p => p.id)).toEqual([
      'laptop-768', 'laptop-768-14', 'laptop-768-11', 'laptop-800-11', 'laptop-900-17', 'laptop-1080-15',
      'mbp-14', 'mbp-16',
      '1080p-24', '1080p-27', '1440p-27', 'sxga-19', '1440x900-19', '4k-27', 'ultrawide-34',
      'phone-320', 'android-65', 'iphone-se', 'iphone-61', 'iphone-67', 'ipad-109', 'ipad-pro-129',
    ])
    expect(findPreset('laptop-768')).toMatchObject({ width: 1366, height: 768, diagonalInches: 15.6, group: 'laptop' })
  })
  /**
   * Every preset's own numbers, checked against the density the manufacturer
   * publishes. A preset is a claim about a real screen: if the CSS size, the
   * scale factor and the diagonal do not agree with the panel's stated PPI,
   * then either a digit is wrong or the preset describes a screen nobody owns
   * — and the app would draw "actual size" at the wrong size while saying it
   * was right. That is the one failure this table can produce silently, so it
   * is the one worth pinning.
   */
  it('each preset matches its panel\'s published pixel density', () => {
    const published: Record<string, number> = {
      'laptop-768': 100, 'laptop-768-14': 112, 'laptop-768-11': 135, 'laptop-800-11': 130,
      'laptop-900-17': 106, 'laptop-1080-15': 141, 'mbp-14': 254, 'mbp-16': 254,
      '1080p-24': 92, '1080p-27': 82, '1440p-27': 109, 'sxga-19': 86, '1440x900-19': 89,
      '4k-27': 163, 'ultrawide-34': 110,
      'phone-320': 326, 'android-65': 270, 'iphone-se': 326, 'iphone-61': 460,
      'iphone-67': 460, 'ipad-109': 264, 'ipad-pro-129': 264,
    }
    for (const p of SCREEN_PRESETS) {
      const dw = p.width * p.deviceScaleFactor
      const dh = p.height * p.deviceScaleFactor
      const ppi = Math.hypot(dw, dh) / p.diagonalInches
      expect(published[p.id], `no published density recorded for ${p.id}`).toBeDefined()
      // Two PPI of slack: manufacturers round their own figures.
      expect(Math.abs(ppi - published[p.id]!), `${p.id} computes ${ppi.toFixed(1)} PPI`).toBeLessThanOrEqual(2)
    }
  })

  it('no preset asks for more device pixels than the target can rasterise', () => {
    // `MAX_VIEWPORT` clamps *device* pixels. A preset past it would be silently
    // shrunk and still labelled 4K — the app would be lying about its own
    // output, which is why 5K and 6K panels are deliberately absent.
    for (const p of SCREEN_PRESETS) {
      expect(p.width * p.deviceScaleFactor, `${p.id} is too wide`).toBeLessThanOrEqual(MAX_VIEWPORT)
      expect(p.height * p.deviceScaleFactor, `${p.id} is too tall`).toBeLessThanOrEqual(MAX_VIEWPORT)
    }
  })
  it('splits into laptop, desktop and mobile groups with no strays', () => {
    const groups = SCREEN_PRESETS.map(p => p.group)
    expect(groups.slice(0, 8)).toEqual(Array(8).fill('laptop'))
    expect(groups.slice(8, 15)).toEqual(Array(7).fill('desktop'))
    expect(groups.slice(15)).toEqual(Array(7).fill('mobile'))
  })
  /**
   * This used to say every laptop and desktop rasterises at 1x, which was true
   * only because the table began as a catalogue of cheap screens. Retina
   * laptops are laptops: the group says what kind of machine it is, not what
   * density it happens to have. What still holds is that a *mobile* preset is
   * never 1x — a phone drawn at 1x would be worse than any phone anyone owns,
   * which is the mistake the mobile entries exist to avoid.
   */
  it('no mobile preset rasterises at 1x', () => {
    for (const p of SCREEN_PRESETS.filter(p => p.group === 'mobile')) {
      expect(p.deviceScaleFactor).toBeGreaterThan(1)
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
    expect(DEFAULT_SETTINGS).toEqual({
      hostDiagonalInches: 27,
      hostNits: 500,
      agentControl: false,
      updateCheck: true,
      lastUpdateCheck: 0,
      recordHistory: true,
      split: 0.5,
      maxTabs: 12,
    })
  })
})
