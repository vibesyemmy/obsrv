import { describe, it, expect } from 'vitest'
import {
  CONTRAST_MAX,
  controlsToParams,
  paramsToControls,
} from '../../src/renderer/src/components/PanelControls'
import { profileToParams } from '../../src/shared/panelSim'
import { findProfile } from '../../src/shared/presets'

const HOST_NITS = 500

describe('paramsToControls', () => {
  it('shows the reference profile as an unlimited, full-gamut 8-bit panel', () => {
    expect(paramsToControls(profileToParams(findProfile('reference'), HOST_NITS), HOST_NITS)).toEqual(
      { nits: 500, contrast: CONTRAST_MAX, gamutPct: 100, bits: 8, frc: false },
    )
  })
  it('shows budget TN in its own units', () => {
    expect(paramsToControls(profileToParams(findProfile('budget-tn'), HOST_NITS), HOST_NITS)).toEqual(
      { nits: 250, contrast: 700, gamutPct: 72, bits: 6, frc: true },
    )
  })
})

describe('round trip', () => {
  for (const id of ['reference', 'office-ips', 'budget-tn', 'old-laptop']) {
    it(`survives ${id}`, () => {
      const params = profileToParams(findProfile(id), HOST_NITS)
      expect(controlsToParams(paramsToControls(params, HOST_NITS), HOST_NITS)).toEqual(params)
    })
  }
})

describe('controlsToParams', () => {
  it('treats the top of the contrast slider as no black lift at all', () => {
    expect(controlsToParams(
      { nits: 500, contrast: CONTRAST_MAX, gamutPct: 100, bits: 8, frc: false },
      HOST_NITS,
    ).blackFloor).toBe(0)
  })
  it('turns bit depth into shader levels', () => {
    const six = controlsToParams({ nits: 500, contrast: 700, gamutPct: 100, bits: 6, frc: false }, HOST_NITS)
    expect(six.levels).toBe(63)
  })
})
