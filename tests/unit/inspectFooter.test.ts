import { describe, expect, it } from 'vitest'
import type { InspectReport } from '../../src/shared/inspect'
import { inspectFooterFacts, type InspectFooterContext } from '../../src/shared/inspectFooter'
import { inspectReadout } from '../../src/shared/inspectReadout'
import { profileToParams } from '../../src/shared/panelSim'
import { DEFAULT_SETTINGS, findPreset, findProfile } from '../../src/shared/presets'

/**
 * The app's footer and the readout (`obsrv inspect`, `obsrv_inspect`) give
 * one element's colour and contrast the same way. The footer passed no
 * `opacity`, so text at `opacity: .5` read at the ratio of the fully opaque
 * colour in the app, where a person reads it, while the CLI and MCP gave the
 * composited one (bug-app-inspect-footer-ignores-opacity).
 */
const dim: InspectReport = {
  tag: 'p',
  id: 'dim',
  classes: '',
  text: 'Dimmed caption',
  rect: { x: 16, y: 8, width: 300, height: 18 },
  fontSizePx: 13,
  fontWeight: 400,
  fontFamily: 'Inter',
  color: [17, 17, 17, 1],
  background: [255, 255, 255, 1],
  backgroundNote: 'computed',
  opacity: 0.5,
  hidden: null,
}

const preset = findPreset('laptop-768')
const contextFor = (profileId: string): InspectFooterContext => {
  const profile = findProfile(profileId)
  return {
    dsf: preset.deviceScaleFactor,
    textScale: 1,
    screen: { width: preset.width, height: preset.height, diagonalInches: preset.diagonalInches },
    params: profileToParams(profile, DEFAULT_SETTINGS.hostNits),
    profile: { id: profile.id, label: profile.label },
    vision: null,
  }
}
const readoutFor = (report: InspectReport, profileId: string) => {
  const profile = findProfile(profileId)
  return inspectReadout(
    report,
    { cssWidth: preset.width, cssHeight: preset.height, deviceScaleFactor: preset.deviceScaleFactor, diagonalInches: preset.diagonalInches, textScale: 1 },
    { profileId: profile.id, profileLabel: profile.label, params: profileToParams(profile, DEFAULT_SETTINGS.hostNits) },
  )
}
const ratio = (facts: string[], suffix: string): number => {
  const fact = facts.find(f => f.endsWith(suffix))
  expect(fact, `no "${suffix}" in ${JSON.stringify(facts)}`).toBeDefined()
  return Number(/^([\d.]+):1/.exec(fact!)![1])
}

describe("the app's inspect footer", () => {
  it('gives an element under opacity the colour the screen shows, and the readout’s contrast', () => {
    const facts = inspectFooterFacts(dim, contextFor('reference'))
    const readout = readoutFor(dim, 'reference')
    // The painted colour leads, and the page's own follows with what changed it.
    expect(facts).toContain(`${readout.colorPainted} on #ffffff (#111111 at opacity 0.5)`)
    // The same figure as the readout, to the footer's one decimal.
    const here = ratio(facts, ' here')
    expect(Math.abs(here - readout.contrast!.asIs)).toBeLessThanOrEqual(0.05)
    // Not vacuous: the opaque colour's ratio is far from it.
    const opaque = readoutFor({ ...dim, opacity: 1 }, 'reference')
    expect(Math.abs(here - opaque.contrast!.asIs)).toBeGreaterThan(5)
  })

  it('on a budget panel, both figures match the readout', () => {
    const facts = inspectFooterFacts(dim, contextFor('budget-tn'))
    const readout = readoutFor(dim, 'budget-tn')
    expect(Math.abs(ratio(facts, ' here') - readout.contrast!.asIs)).toBeLessThanOrEqual(0.05)
    expect(Math.abs(ratio(facts, ` on ${findProfile('budget-tn').label}`) - readout.contrast!.onPanel)).toBeLessThanOrEqual(0.05)
  })

  it('an opaque colour keeps its plain pair, and the reference panel is not quoted twice', () => {
    const facts = inspectFooterFacts({ ...dim, opacity: 1 }, contextFor('reference'))
    expect(facts).toContain('#111111 on #ffffff')
    expect(facts.some(f => f.includes(' on Reference'))).toBe(false)
  })
})
