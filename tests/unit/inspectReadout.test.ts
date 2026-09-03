import { describe, expect, it } from 'vitest'
import type { InspectReport } from '../../src/shared/inspect'
import { inspectReadout, isLargeText, type InspectPanel, type InspectScreen } from '../../src/shared/inspectReadout'
import { profileToParams } from '../../src/shared/panelSim'
import { DEFAULT_SETTINGS, findPreset, findProfile } from '../../src/shared/presets'
import { visionMatrix } from '../../src/shared/vision'

const grey: InspectReport = {
  tag: 'p',
  id: 'grey',
  classes: 'caption small',
  text: 'Grey caption text on white',
  rect: { x: 16.4, y: 8, width: 300, height: 18.2 },
  fontSizePx: 13,
  fontWeight: 400,
  fontFamily: 'Inter',
  color: [107, 114, 128, 1],
  background: [255, 255, 255, 1],
  backgroundNote: 'computed',
}

const screenOf = (id: string, textScale = 1): InspectScreen => {
  const p = findPreset(id)
  return { cssWidth: p.width, cssHeight: p.height, deviceScaleFactor: p.deviceScaleFactor, diagonalInches: p.diagonalInches, textScale }
}
const panelOf = (id: string): InspectPanel => {
  const profile = findProfile(id)
  return { profileId: profile.id, profileLabel: profile.label, params: profileToParams(profile, DEFAULT_SETTINGS.hostNits) }
}

describe('inspectReadout', () => {
  it('names the element, gives the font in millimetres on the screen, and the contrast twice', () => {
    const r = inspectReadout(grey, screenOf('laptop-768'), panelOf('reference'))
    expect(r.element).toBe('p#grey.caption')
    expect(r.ppi).toBe(100)
    expect(r.font.px).toBe(13)
    expect(r.font.mm).toBeCloseTo(3.29, 2)
    expect(r.rect).toEqual({ x: 16.4, y: 8, width: 300, height: 18.2 })
    expect(r.rectMm?.width).toBeCloseTo(75.86, 1)
    expect(r.color).toBe('#6b7280')
    expect(r.background).toBe('#ffffff')
    expect(r.contrast).toMatchObject({ largeText: false, aaThreshold: 4.5, passesAsIs: true, panel: 'reference' })
    expect(r.contrast!.asIs).toBeCloseTo(4.83, 2)
    // The reference panel is the identity: the two figures agree.
    expect(r.contrast!.onPanel).toBeCloseTo(r.contrast!.asIs, 1)
    expect(r.contrast!.vision).toBeUndefined()
  })
  it('a budget TN panel pulls the pair together: the second figure is lower, and can fail where the first passes', () => {
    const r = inspectReadout(grey, screenOf('laptop-768'), panelOf('budget-tn'))
    expect(r.contrast!.onPanel).toBeLessThan(r.contrast!.asIs)
    expect(r.contrast!.panel).toBe('budget-tn')
    expect(r.contrast!.passesAsIs).toBe(true)
    expect(r.contrast!.passesOnPanel).toBe(r.contrast!.onPanel >= 4.5)
  })
  it('a vision simulation is named and applied to the panel figure', () => {
    const panel = { ...panelOf('reference'), vision: { label: 'deutan 100%', matrix: visionMatrix('deutan', 1) } }
    const r = inspectReadout({ ...grey, color: [200, 0, 0, 1], background: [0, 160, 0, 1] }, screenOf('laptop-768'), panel)
    expect(r.contrast!.vision).toBe('deutan 100%')
    expect(r.contrast!.onPanel).not.toBeCloseTo(r.contrast!.asIs, 1)
  })
  it('millimetres follow the screen: the same 13px is bigger on a 24" 1080p and smaller on a phone', () => {
    expect(inspectReadout(grey, screenOf('1080p-24'), panelOf('reference')).font.mm).toBeCloseTo(3.6, 1)
    // 13 px at 2x on a 6.5" 720-wide phone: 26 device px at ~270 ppi, 2.45 mm.
    expect(inspectReadout(grey, screenOf('android-65'), panelOf('reference')).font.mm).toBeCloseTo(2.45, 1)
  })
  it('a text scale grows the font on the glass but not the box, which is already in surface px', () => {
    const plain = inspectReadout(grey, screenOf('laptop-768'), panelOf('reference'))
    const scaled = inspectReadout(grey, screenOf('laptop-768', 1.5), panelOf('reference'))
    expect(scaled.font.mm).toBeCloseTo(plain.font.mm! * 1.5, 1)
    expect(scaled.rectMm).toEqual(plain.rectMm)
  })
  it('no diagonal: no density, no millimetres, everything else intact', () => {
    const r = inspectReadout(grey, { ...screenOf('laptop-768'), diagonalInches: null }, panelOf('reference'))
    expect(r.ppi).toBeNull()
    expect(r.font.mm).toBeNull()
    expect(r.rectMm).toBeNull()
    expect(r.contrast!.asIs).toBeCloseTo(4.83, 2)
  })
  it('text over an image has colours but no contrast, and says so', () => {
    const r = inspectReadout({ ...grey, background: null, backgroundNote: 'image' }, screenOf('laptop-768'), panelOf('reference'))
    expect(r.background).toBeNull()
    expect(r.backgroundNote).toBe('image')
    expect(r.contrast).toBeNull()
  })
  it('large text is judged at 3:1', () => {
    expect(isLargeText(24, 400)).toBe(true)
    expect(isLargeText(23.9, 400)).toBe(false)
    expect(isLargeText(18.66, 700)).toBe(true)
    expect(isLargeText(18.66, 600)).toBe(false)
    const r = inspectReadout({ ...grey, fontSizePx: 24, color: [140, 140, 140, 1] }, screenOf('laptop-768'), panelOf('reference'))
    expect(r.contrast).toMatchObject({ largeText: true, aaThreshold: 3, passesAsIs: true })
    const small = inspectReadout({ ...grey, fontSizePx: 14, color: [140, 140, 140, 1] }, screenOf('laptop-768'), panelOf('reference'))
    expect(small.contrast).toMatchObject({ largeText: false, aaThreshold: 4.5, passesAsIs: false })
  })
})
