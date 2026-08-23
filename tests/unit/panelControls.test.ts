import { describe, it, expect } from 'vitest'
import {
  CONTRAST_MAX,
  CUSTOM_PROFILE_ID,
  customProfile,
  profileToControls,
} from '../../src/renderer/src/components/PanelControls'
import { profileToParams } from '../../src/shared/panelSim'
import { findProfile } from '../../src/shared/presets'

const HOST_NITS = 500

describe('profileToControls', () => {
  it('shows the reference profile as an unlimited, full-gamut 8-bit panel at host brightness', () => {
    expect(profileToControls(findProfile('reference'), HOST_NITS)).toEqual(
      { nits: 500, contrast: CONTRAST_MAX, gamutPct: 100, bits: 8, frc: false },
    )
  })
  it('shows budget TN in its own units', () => {
    expect(profileToControls(findProfile('budget-tn'), HOST_NITS)).toEqual(
      { nits: 250, contrast: 700, gamutPct: 72, bits: 6, frc: true },
    )
  })
})

describe('customProfile', () => {
  it('is labelled as the custom panel', () => {
    const c = customProfile(findProfile('budget-tn'), HOST_NITS, {})
    expect(c.id).toBe(CUSTOM_PROFILE_ID)
    expect(c.label).toBe('Custom panel')
  })

  for (const id of ['reference', 'office-ips', 'budget-tn', 'old-laptop']) {
    it(`simulates ${id} identically until a slider moves`, () => {
      const base = findProfile(id)
      expect(profileToParams(customProfile(base, HOST_NITS, {}), HOST_NITS)).toEqual(
        profileToParams(base, HOST_NITS),
      )
    })
  }

  it('treats the top of the contrast slider as no black lift at all', () => {
    expect(customProfile(findProfile('budget-tn'), HOST_NITS, { contrast: CONTRAST_MAX }).contrastRatio)
      .toBeNull()
    expect(customProfile(findProfile('reference'), HOST_NITS, { contrast: 700 }).contrastRatio)
      .toBe(700)
  })

  it('resolves "same as host" brightness to an absolute figure', () => {
    // The reference profile carries nits: null; the custom one never does, so
    // a later change to the host nits setting leaves the hand-tuned panel alone.
    const c = customProfile(findProfile('reference'), HOST_NITS, {})
    expect(c.nits).toBe(HOST_NITS)
    expect(profileToParams(c, 250).brightness).toBe(2)
  })

  it('changes only the value moved', () => {
    const c = customProfile(findProfile('budget-tn'), HOST_NITS, { bits: 8 })
    expect(c).toMatchObject({ contrastRatio: 700, gamutCoverage: 0.72, bits: 8, frc: true, nits: 250 })
    expect(profileToParams(c, HOST_NITS).levels).toBe(255)
  })

  it('turns bit depth into shader levels', () => {
    const six = customProfile(findProfile('reference'), HOST_NITS, { bits: 6 })
    expect(profileToParams(six, HOST_NITS).levels).toBe(63)
  })
})
