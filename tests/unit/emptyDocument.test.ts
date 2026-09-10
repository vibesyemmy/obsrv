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
