import { describe, expect, it } from 'vitest'
import { flowCoverageNote, type FlowStepOutcome } from '../../src/shared/walkCoverage'

/**
 * The flow report leads with what it did not cover, so this sentence is the
 * first thing a QA engineer reads. Its silence has to mean one thing only:
 * every step was attempted and every step's evidence was measured on a page
 * that had stopped moving. Anything else and the report is describing part of
 * a flow while looking like it describes the flow.
 */
// Three separate helpers, not one with a default: `unmeasured()` would hit
// the default parameter and silently mean `settled: true`, which is how the
// first version of this file passed two tests it was not testing.
const ran = (): FlowStepOutcome => ({ status: 'ran', settled: true })
const painting = (): FlowStepOutcome => ({ status: 'ran', settled: false })
const unmeasured = (): FlowStepOutcome => ({ status: 'ran' })

describe('flowCoverageNote', () => {
  it('says nothing when every step ran and every step settled', () => {
    expect(flowCoverageNote([ran(), ran(), ran()])).toBeNull()
  })

  it('says nothing for a flow with no steps', () => {
    expect(flowCoverageNote([])).toBeNull()
  })

  it('names the step that failed, and refuses to let absence read as clean', () => {
    const note = flowCoverageNote([ran(), { status: 'failed', settled: true }, { status: 'not-reached' }, { status: 'not-reached' }])
    expect(note).toContain('2 of 4 steps were never attempted')
    expect(note).toContain('step 2 failed')
    expect(note).toContain('not evidence that they were clean')
  })

  it('uses singular wording for a single unattempted step', () => {
    const note = flowCoverageNote([{ status: 'failed', settled: true }, { status: 'not-reached' }])
    expect(note).toContain('1 of 2 steps was never attempted')
    expect(note).toContain('not evidence that it was clean')
  })

  it('reports a step measured while the page was still painting', () => {
    const note = flowCoverageNote([ran(), painting()])
    expect(note).toContain('1 step was measured while the page was still painting')
    expect(note).toContain('a frame behind')
  })

  it('reports a step whose settle state could not be checked, as unknown rather than fine', () => {
    const note = flowCoverageNote([ran(), unmeasured()])
    expect(note).toContain('could not be checked for whether the page had settled')
    expect(note).toContain('unknown rather than fine')
  })

  it('does not count an unattempted step as unsettled — it was never measured at all', () => {
    const note = flowCoverageNote([{ status: 'failed', settled: true }, { status: 'not-reached' }])
    expect(note).not.toContain('still painting')
    expect(note).not.toContain('could not be checked')
  })

  it('joins several facts rather than reporting only the first', () => {
    const note = flowCoverageNote([painting(), unmeasured(), { status: 'failed', settled: true }, { status: 'not-reached' }])
    expect(note).toContain('never attempted')
    expect(note).toContain('still painting')
    expect(note).toContain('could not be checked')
    expect(note!.split('; ')).toHaveLength(3)
  })

  it('does not name a step number it cannot see', () => {
    // Defensive: `not-reached` without a `failed` anywhere is not a shape the
    // runner produces, and it must not print "step 0 failed".
    const note = flowCoverageNote([ran(), { status: 'not-reached' }])
    expect(note).toContain('the flow stopped early')
    expect(note).not.toMatch(/step \d+ failed/)
  })
})
