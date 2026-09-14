import { describe, expect, it } from 'vitest'
import { noEvidenceMessage, measuredNothing } from '../../src/shared/established'

/**
 * The second way to a green that means nothing: a test that passed having
 * checked nothing. Its pass fits "everything is fine" and "there was nothing
 * to look at", and the two are indistinguishable from the result alone.
 *
 * `surface-parity.spec.ts` has the only instance anyone has written, found the
 * hard way — a filtered run starved the rows it compares, so a planted stale
 * row passed green. This is that assertion's message, generalised so the next
 * one does not have to be discovered the same way.
 */
describe('measuredNothing', () => {
  it('is true only when the count is zero', () => {
    expect(measuredNothing(0)).toBe(true)
    expect(measuredNothing(1)).toBe(false)
  })

  it('names what was counted, and says a pass here is not evidence', () => {
    const text = noEvidenceMessage('tool compared on any page', 'run the whole file rather than a filtered subset')
    expect(text).toContain('tool compared on any page')
    expect(text).toMatch(/not evidence/i)
    expect(text).toContain('run the whole file rather than a filtered subset')
  })

  it('does not say "no results", which fits both facts equally', () => {
    // "no results" is true when the thing under test is clean and when nothing
    // ran. The message has to pick the second reading out loud, because the
    // first is the one a reader assumes.
    const text = noEvidenceMessage('page was measured', 'run the file whole')
    expect(text).not.toMatch(/^no results/i)
    expect(text).toMatch(/nothing to check|had nothing|never ran|no evidence/i)
  })
})
