import { describe, expect, it } from 'vitest'
import { announceIfExcluded, EXCLUSION_LINE } from '../../tests/e2e/cliSpecsAnnounce'

/**
 * `chore-desk-safe-run-says-what-it-left-out`: a local run that left the
 * CLI-launch specs out says so, once, in a sentence naming the variable that
 * lifts it. Driven with an injected env and a captured log rather than a
 * real `playwright test` invocation — the same reason `cliSpecsGate.ts`
 * takes an `env` parameter — so this is desk-safe and needs no Electron boot.
 */
describe('announceIfExcluded', () => {
  it('prints the line when nobody opted in and CI is unset', () => {
    const lines: string[] = []
    announceIfExcluded({}, l => lines.push(l))
    expect(lines).toEqual([EXCLUSION_LINE])
    expect(EXCLUSION_LINE).toContain('OBSRV_E2E_CLI=1')
  })

  it('is silent once OBSRV_E2E_CLI=1', () => {
    const lines: string[] = []
    announceIfExcluded({ OBSRV_E2E_CLI: '1' }, l => lines.push(l))
    expect(lines).toEqual([])
  })

  it('is silent on CI, whatever CI is set to', () => {
    const lines: string[] = []
    announceIfExcluded({ CI: '' }, l => lines.push(l))
    expect(lines).toEqual([])
  })

  it('prints at most once per call, even with a value CI could plausibly set for OBSRV_E2E_CLI', () => {
    const lines: string[] = []
    announceIfExcluded({ OBSRV_E2E_CLI: 'true' }, l => lines.push(l))
    // 'true' is not the literal '1' the opt-in checks for, so this is still
    // excluded — a reader who set the wrong value still gets told why.
    expect(lines).toEqual([EXCLUSION_LINE])
  })
})
