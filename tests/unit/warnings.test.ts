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
    expect(said).toEqual(['warning: page kept painting steadily; capturing the current frame'])
  })

  it('keeps different warnings in the order they came', () => {
    const { warnings, warn } = warningSink(() => {})
    warn('a')
    warn('b')
    warn('a')
    warn('c')
    expect(warnings).toEqual(['a', 'b', 'c'])
  })

  /**
   * The sink owns the label. A caller says the fact; the machine list keeps
   * the fact bare; the stderr line carries `warning: ` because that is where
   * a label earns its place. Until this test, every caller composed the label
   * into the message itself, so `warnings[]` carried stderr formatting — and
   * the report, prefixing each entry with its provenance, printed
   * "full page: warning: full page is…" (run 18, uniqlo), and diff printed
   * "target: warning: …" the same way. Not every caller did it, either:
   * capture.ts's onWarn messages arrived bare, so one snap's list mixed both
   * forms. audit/lint/inspect already stored bare and labelled at the
   * boundary (main.ts:1084); this makes snap and report do the same.
   */
  it('stores the fact bare and labels only the stderr line', () => {
    const said: string[] = []
    const { warnings, warn } = warningSink(m => said.push(m))
    warn('full page is 10374 CSS px tall; clamped to 4096')
    expect(warnings).toEqual(['full page is 10374 CSS px tall; clamped to 4096'])
    expect(said).toEqual(['warning: full page is 10374 CSS px tall; clamped to 4096'])
  })

  it('does not double a label a caller still composes, so a missed call site reads wrong rather than twice wrong', () => {
    // A caller that still says `warning: …` is a defect to fix at the caller;
    // the sink must not paper over it by stripping, because then the machine
    // list would silently differ from what the caller wrote. It stores what
    // it was given and labels once on stderr. The doubled stderr line is the
    // tell that a caller was missed.
    const said: string[] = []
    const { warnings, warn } = warningSink(m => said.push(m))
    warn('warning: legacy')
    expect(warnings).toEqual(['warning: legacy'])
    expect(said).toEqual(['warning: warning: legacy'])
  })
})
