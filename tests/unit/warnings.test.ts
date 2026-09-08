import { describe, it, expect } from 'vitest'
import { warningSink } from '../../src/cli/warnings'

/**
 * A render's warnings are one list for the whole render, and a full-page
 * capture takes a page in bands, each captured quiescent on its own — so a
 * page that keeps animating said "kept painting steadily … capturing the
 * current frame" once per band, verbatim, and the report printed all of them
 * (measured: apple.com, five identical lines under one screen). A warning
 * describes the page, not the band; the second identical one adds nothing.
 */
describe('warningSink', () => {
  it('keeps the first of identical warnings and says it once', () => {
    const said: string[] = []
    const { warnings, warn } = warningSink(m => said.push(m))
    warn('page kept painting steadily; capturing the current frame')
    warn('page kept painting steadily; capturing the current frame')
    warn('page kept painting steadily; capturing the current frame')
    expect(warnings).toEqual(['page kept painting steadily; capturing the current frame'])
    expect(said).toEqual(['page kept painting steadily; capturing the current frame'])
  })

  it('keeps different warnings in the order they came', () => {
    const { warnings, warn } = warningSink(() => {})
    warn('a')
    warn('b')
    warn('a')
    warn('c')
    expect(warnings).toEqual(['a', 'b', 'c'])
  })
})
