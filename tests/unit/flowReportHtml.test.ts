import { describe, expect, it } from 'vitest'
import { flowReportHtml, flowStepState, type FlowReportData, type FlowReportStep } from '../../src/cli/reportHtml'

/**
 * Written against `board/feat-flow-report.md`'s acceptance list, one test per
 * clause, because the clauses are the product: a report that leads with its
 * findings, folds `unknown` into clean, or pronounces pass on a sentence
 * nobody measured is the wrong document however well it renders.
 */
const step = (over: Partial<FlowReportStep> = {}): FlowReportStep => ({ action: 'click', target: '.pay', status: 'ran', settled: true, ...over })

/** Just one step's own section. The footer carries a legend that includes the
 *  literal `<span class="state unknown">unknown</span>`, so asserting that
 *  markup against the whole document passes even when the step's badge is
 *  wrong — the first version of the unknown-badge test below did exactly that,
 *  and survived a sabotage that folded unknown into ran. */
const sectionOf = (html: string, n: number): string => {
  const from = html.indexOf(`id="step-${n}"`)
  const to = html.indexOf('<footer')
  expect(from).toBeGreaterThan(-1)
  expect(to).toBeGreaterThan(from)
  return html.slice(from, to)
}

const data = (steps: FlowReportStep[], refused?: string): FlowReportData => ({
  url: 'https://shop.test/cart',
  generatedAt: '2026-09-26T11:00:00Z',
  version: '0.62.1',
  steps,
  ...(refused !== undefined ? { refused } : {}),
})

describe('flowStepState', () => {
  it('calls a settled run ran', () => expect(flowStepState(step()).label).toBe('ran'))
  it('calls a failed step failed', () => expect(flowStepState(step({ status: 'failed' })).label).toBe('failed'))
  it('calls an unattempted step not reached', () => expect(flowStepState(step({ status: 'not-reached', settled: undefined })).label).toBe('not reached'))
  it('calls a run measured while painting unknown, not ran', () => {
    expect(flowStepState(step({ settled: false })).label).toBe('unknown')
  })
  it('calls a run whose settle check could not answer unknown, not ran', () => {
    expect(flowStepState(step({ settled: undefined })).label).toBe('unknown')
  })
})

describe('flowReportHtml', () => {
  it('leads with what it did not cover, above the steps', () => {
    const html = flowReportHtml(data([step(), { action: 'click', status: 'failed' }, { action: 'audit', status: 'not-reached' }]))
    const coverage = html.indexOf('does not cover the whole flow')
    const steps = html.indexOf('<h2>The steps</h2>')
    expect(coverage).toBeGreaterThan(-1)
    expect(steps).toBeGreaterThan(-1)
    expect(coverage).toBeLessThan(steps)
  })

  it('says so explicitly when it did cover everything, rather than being silent', () => {
    const html = flowReportHtml(data([step(), step()]))
    expect(html).toContain('Every step was attempted')
    expect(html).not.toContain('does not cover the whole flow')
  })

  it('lists every step including the ones never attempted', () => {
    const html = flowReportHtml(data([step(), { action: 'click', status: 'failed' }, { action: 'audit', status: 'not-reached' }, { action: 'lint', status: 'not-reached' }]))
    for (const n of [1, 2, 3, 4]) expect(html).toContain(`id="step-${n}"`)
    expect(html).toContain('not reached')
  })

  it('gives an unknown step its own visible state, not a clean one', () => {
    const html = flowReportHtml(data([step({ settled: false, unsettledReason: 'animating' })]))
    // Scoped to the step, not the document: see `sectionOf`.
    expect(sectionOf(html, 1)).toContain('<span class="state unknown">unknown</span>')
    expect(sectionOf(html, 1)).toContain('still painting')
    expect(sectionOf(html, 1)).toContain('animating')
  })

  it('separates what Obsrv measured from what the engineer asked to see', () => {
    const html = flowReportHtml(data([step({ expect: 'the order number is visible' })]))
    expect(html).toContain('What Obsrv measured')
    expect(html).toContain('What you asked to see')
    expect(html).toContain('the order number is visible')
  })

  it('does not pronounce pass or fail on a stated expectation', () => {
    const html = flowReportHtml(data([step({ expect: 'the order number is visible' })]))
    expect(html).toContain('Obsrv does not judge this')
    expect(html).not.toMatch(/expectation (met|passed|failed)/i)
  })

  it('says nothing was stated when no expectation was given', () => {
    const html = flowReportHtml(data([step()]))
    expect(html).toContain('Nothing was stated for this step')
  })

  it('does not claim a settle state for a step that was never attempted', () => {
    const html = flowReportHtml(data([{ action: 'audit', status: 'not-reached' }]))
    expect(html).toContain('the flow stopped before this step')
    expect(html).not.toContain('had stopped painting when')
  })

  it('reports a refusal as the flow not having run at all', () => {
    const html = flowReportHtml(data([], 'a flow started 40s ago by pid 1234 holds this app'))
    expect(html).toContain('The flow did not run')
    expect(html).toContain('pid 1234')
  })

  it('escapes an expectation and an error rather than letting them close a tag', () => {
    const html = flowReportHtml(data([step({ expect: '<img src=x onerror=1>', error: '</main><script>bad()</script>' })]))
    expect(html).not.toContain('<img src=x')
    expect(html).not.toContain('<script>bad()')
    expect(html).toContain('&lt;img src=x')
  })

  it('embeds the step screenshot it was given', () => {
    const html = flowReportHtml(data([step({ data: 'QUJD' })]))
    expect(html).toContain('src="data:image/png;base64,QUJD"')
  })
})
