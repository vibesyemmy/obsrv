import { describe, expect, it } from 'vitest'
import { EMPTY_GRACE_MS, EMPTY_POLL_MS, awaitContent, emptyDocumentNote, isEmptyAuditReport, isEmptyLintReport } from '../../src/shared/emptyDocument'

describe('empty document', () => {
  it('an audit report is empty with no target and no text; a lint report with no text, edge or image', () => {
    expect(isEmptyAuditReport({ targets: [], text: [] })).toBe(true)
    expect(isEmptyAuditReport({ targets: [], text: [1] })).toBe(false)
    expect(isEmptyLintReport({ text: [], edges: [], images: [] })).toBe(true)
    expect(isEmptyLintReport({ text: [], edges: [], images: [1] })).toBe(false)
  })
  it('the note says what was missing, for how long, and what to do', () => {
    expect(emptyDocumentNote('audit', 3012)).toBe(
      'nothing to measure: the page had no visible text and no targets 3 s after it loaded — a page rendered by script that had not run yet, ' +
        'a bot wall, or an empty document; the figures are of an empty page, and waitMs (--wait) gives a page that renders late longer',
    )
    expect(emptyDocumentNote('lint', 3000)).toContain('no visible text, edges or images 3 s after')
  })
  it('names the iframe the visible page is, when it is one, so a wall is not read as a blank page', () => {
    // etsy.com's DataDome wall: one iframe over the whole viewport, and a
    // snap that shows a heading and a slider. The measurement does not
    // enter iframes; the sentence must say that is where the page is.
    const note = emptyDocumentNote('audit', 3000, { count: 1, viewportCoverage: 1 })
    expect(note).toContain('nothing to measure')
    expect(note).toContain('an <iframe> covers 100% of the viewport, which the measurement does not enter')
    expect(emptyDocumentNote('lint', 3000, { count: 2, viewportCoverage: 0.634 })).toContain('2 <iframe>s cover 63% of the viewport')
    expect(emptyDocumentNote('lint', 3000, { count: 0, viewportCoverage: 0 })).not.toContain('iframe')
    expect(emptyDocumentNote('lint', 3000)).not.toContain('iframe')
  })

  it('a report with content is taken at once', async () => {
    let asked = 0
    const r = await awaitContent(async () => (asked++, { text: ['a'] }), () => false, { sleep: async () => {} })
    expect(r).toEqual({ report: { text: ['a'] }, waitedMs: 0, stillEmpty: false, arrived: false })
    expect(asked).toBe(1)
  })
  it('an empty report is re-asked every poll until content arrives, and says it arrived', async () => {
    let clock = 0
    const sleep = async (ms: number): Promise<void> => {
      clock += ms
    }
    let asked = 0
    // booking.com: empty at load, content 900 ms later.
    const measure = async (): Promise<{ n: number }> => ({ n: (asked++, clock >= 900 ? 3 : 0) })
    const r = await awaitContent(measure, x => x.n === 0, { sleep, now: () => clock })
    expect(r.arrived).toBe(true)
    expect(r.stillEmpty).toBe(false)
    expect(r.report).toEqual({ n: 3 })
    expect(r.waitedMs).toBe(1000)
    expect(asked).toBe(5)
  })
  it('an empty report is given up on at the grace, and says so', async () => {
    let clock = 0
    const sleep = async (ms: number): Promise<void> => {
      clock += ms
    }
    const r = await awaitContent(async () => ({ n: 0 }), x => x.n === 0, { sleep, now: () => clock })
    expect(r.stillEmpty).toBe(true)
    expect(r.arrived).toBe(false)
    expect(r.waitedMs).toBe(EMPTY_GRACE_MS)
    expect(EMPTY_GRACE_MS / EMPTY_POLL_MS).toBe(12)
  })
  it('a page that stops answering ends the wait as it stands', async () => {
    let asked = 0
    const r = await awaitContent(async () => (asked++ === 0 ? { n: 0 } : null), x => x.n === 0, { sleep: async () => {} })
    expect(r.report).toBeNull()
    expect(r.stillEmpty).toBe(false)
  })
})

/**
 * A report whose entries the checks dropped is not an empty document: the
 * page had content and the measurement refused it. Saying "the page had no
 * visible text" there is simply false, and it hides the drop behind a
 * plausible story about a page that renders late.
 */
describe('a report emptied by dropped entries', () => {
  it('is not an empty lint report', () => {
    expect(isEmptyLintReport({ text: [], edges: [], images: [] })).toBe(true)
    expect(isEmptyLintReport({ text: [], edges: [], images: [], dropped: { text: 1 } })).toBe(false)
  })

  it('is not an empty audit report', () => {
    expect(isEmptyAuditReport({ targets: [], text: [] })).toBe(true)
    expect(isEmptyAuditReport({ targets: [], text: [], dropped: { targets: 2 } })).toBe(false)
  })

  it('an empty `dropped` block still reads as empty', () => {
    expect(isEmptyLintReport({ text: [], edges: [], images: [], dropped: {} })).toBe(true)
  })
})

/**
 * chromestatus.com/features (2026-09-12): 0 targets and 0 text, and the
 * note offered three causes — a script that had not run, a bot wall, an
 * empty document. All three were false. The page holds 159 shadow roots
 * with 136 interactive elements in them, which the measurement does not
 * enter. When that is what happened, the note should say so instead of
 * guessing, and should not advise waiting longer: waiting cannot help.
 */
describe('a page whose content is in shadow roots', () => {
  const shadow = { hosts: 159, interactive: 136, text: 147 }

  it('names the shadow roots and what they hold', () => {
    const note = emptyDocumentNote('audit', 3000, undefined, shadow)
    expect(note).toContain('159 shadow roots')
    expect(note).toContain('136 interactive elements')
    expect(note).toContain('does not enter')
  })

  it('drops the three causes that are false, and the advice that cannot help', () => {
    const note = emptyDocumentNote('audit', 3000, undefined, shadow)
    expect(note).not.toContain('a bot wall')
    expect(note).not.toContain('had not run yet')
    expect(note).not.toContain('renders late longer')
  })

  it('says the light DOM is what the figures are of', () => {
    expect(emptyDocumentNote('lint', 3000, undefined, shadow)).toContain('light DOM')
  })

  it('counts one root in the singular', () => {
    const note = emptyDocumentNote('audit', 3000, undefined, { hosts: 1, interactive: 1, text: 0 })
    expect(note).toContain('1 shadow root ')
    expect(note).not.toContain('1 shadow roots')
  })

  it('leaves the old sentence alone when there are no shadow roots', () => {
    const note = emptyDocumentNote('audit', 3000, undefined, { hosts: 0, interactive: 0, text: 0 })
    expect(note).toContain('a page rendered by script that had not run yet, a bot wall, or an empty document')
  })
})

/**
 * An iframe that covers none of the viewport is not a bot wall and not an
 * embed worth naming — chromestatus.com carries one, and the clause read
 * "an <iframe> covers 0% of the viewport … a bot wall or an embed", which is
 * noise beside the true cause (2026-09-12).
 */
describe('an iframe too small to matter', () => {
  it('earns no clause at 0% of the viewport', () => {
    const note = emptyDocumentNote('audit', 3000, { count: 1, viewportCoverage: 0.001 })
    expect(note).not.toContain('<iframe>')
  })

  it('still names one that covers the viewport', () => {
    expect(emptyDocumentNote('audit', 3000, { count: 1, viewportCoverage: 1 })).toContain('an <iframe> covers 100%')
  })
})
