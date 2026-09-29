import { describe, expect, it } from 'vitest'
import { flowReportHtml, flowStepState, type FlowReportData, type FlowReportNetwork, type FlowReportObservation, type FlowReportPageState, type FlowReportStep } from '../../src/cli/reportHtml'

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
/** The summary table's body, so a row-count assertion cannot be satisfied by
 *  the per-step sections further down. Idris removed the not-reached rows from
 *  this table and all 25 tests stayed green, because `toContain('not reached')`
 *  was answered by the step badges alone. */
const tableBody = (html: string): string => {
  const from = html.indexOf('<tbody>')
  const to = html.indexOf('</tbody>', from)
  expect(from).toBeGreaterThan(-1)
  expect(to).toBeGreaterThan(from)
  return html.slice(from, to)
}

/** One step's "what you asked to see" block, so the no-verdict rule is checked
 *  where a verdict would actually appear rather than against the whole page. */
const askedHalfOf = (html: string, n: number): string => {
  const sec = sectionOf(html, n)
  const from = sec.indexOf('What you asked to see')
  expect(from, 'the step has no asked-to-see block').toBeGreaterThan(-1)
  return sec.slice(from)
}

/** One step's section and **only** that step's. This bounded at `<footer`
 *  before, so step 1's "section" ran to the end of the document and included
 *  every later step: a claim about step 1 could be satisfied by step 3's
 *  markup, in a helper whose whole job is to stop exactly that. Found while
 *  adding the observation tests below, which compare a `present` step against
 *  an `absent` one and would have been mutually satisfiable. Now it stops at
 *  the next step's own id. */
const sectionOf = (html: string, n: number): string => {
  const from = html.indexOf(`id="step-${n}"`)
  expect(from).toBeGreaterThan(-1)
  const next = html.indexOf('id="step-', from + 1)
  const footer = html.indexOf('<footer')
  expect(footer).toBeGreaterThan(from)
  const to = next > -1 && next < footer ? next : footer
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


  it('gives the summary table one row per step, including the ones never attempted', () => {
    // Idris's sabotage: filtering not-reached rows out of the table left every
    // test green, because nothing counted the rows.
    const steps = [step(), { action: 'click', status: 'failed' as const }, { action: 'audit', status: 'not-reached' as const }, { action: 'lint', status: 'not-reached' as const }]
    const body = tableBody(flowReportHtml(data(steps)))
    expect(body.match(/<tr>/g) ?? []).toHaveLength(steps.length)
    for (const n of [1, 2, 3, 4]) expect(body).toContain(`<td class="n">${n}</td>`)
  })

  it('carries no verdict vocabulary at all in the asked-to-see block', () => {
    // Idris's sabotage: "Result: pass" beside an expectation passed every test,
    // because the guard forbade three phrasings rather than the whole idea.
    // This forbids the vocabulary, in the one block where a verdict would sit.
    const asked = askedHalfOf(flowReportHtml(data([step({ expect: 'the order number is visible' })])), 1)
    expect(asked).toContain('Obsrv does not judge this')
    expect(asked).not.toMatch(/\b(pass|passed|passes|fail|failed|fails|met|unmet|satisfied|correct|incorrect|verdict|assert\w*)\b/i)
  })

  it('says an empty flow was empty, rather than giving it the all-clear', () => {
    // The card's thesis inverted: zero steps driven must not read as a page
    // that came back clean.
    const html = flowReportHtml(data([]))
    expect(html).toContain('This flow had no steps')
    expect(html).not.toContain('Every step was attempted')
  })


  it('renders a link when the flow navigated somewhere', () => {
    const html = flowReportHtml({ ...data([step()]), url: 'https://shop.test/cart' })
    expect(html).toContain('<a href="https://shop.test/cart">https://shop.test/cart</a>')
  })

  it('renders NO anchor at all when the flow never navigated', () => {
    // The defect: `flowSubject` used to return the sentence "the page the app
    // already had open", which the header rendered into `<a href="...">` — a
    // broken link whose href was prose. Driving a page the app already had open
    // is the ordinary case, so this is not an edge.
    const { url: _drop, ...noUrl } = data([step()])
    const html = flowReportHtml(noUrl)
    const head = html.slice(0, html.indexOf('<h2>'))
    expect(head).not.toContain('<a href=')
    expect(head).toContain('this flow never navigated')
  })

  it('keeps the address out of the document title when there is none', () => {
    const { url: _drop, ...noUrl } = data([step()])
    const html = flowReportHtml(noUrl)
    expect(html).toContain('<title>Obsrv flow report</title>')
  })


  /**
   * The stated-observation clause. These key off `askedHalfOf`, never the whole
   * document: the footer's own prose mentions stated expectations, and the
   * summary table names every step, so an unscoped `toContain` here would be
   * answered by text nowhere near the badge it claims to check.
   */
  const obs = (over: Partial<FlowReportObservation> = {}): FlowReportObservation => ({
    expected: 'Order confirmed',
    state: 'unknown',
    looked: 'no reader was configured for this run, so nothing was read',
    ...over,
  })

  it('shows a found text as a reading, with where it looked and what it read', () => {
    const html = flowReportHtml(
      data([step({ observations: [obs({ state: 'present', looked: 'read the whole document', saw: ['Order confirmed #4471'] })] })]),
    )
    const asked = askedHalfOf(html, 1)
    expect(asked).toContain('<span class="state saw">text found</span>')
    expect(asked).toContain('Order confirmed')
    expect(asked).toContain('read the whole document')
    expect(asked).toContain('Order confirmed #4471')
  })

  it('prints where it looked even when the text was found, so the trusted row is the evidenced one', () => {
    const html = flowReportHtml(data([step({ observations: [obs({ state: 'present', looked: 'read the whole document' })] })]))
    expect(askedHalfOf(html, 1)).toContain('read the whole document')
  })

  it('does not render a missing text as a failure, because a QA engineer can state text that should be gone', () => {
    const html = flowReportHtml(data([step({ status: 'ran', settled: true, observations: [obs({ state: 'absent', looked: 'read the whole document' })] })]))
    const sec = sectionOf(html, 1)
    expect(sec).toContain('<span class="state missing">text not found</span>')
    // The step ran. Nothing in its own section may claim otherwise — this is
    // the assertion that a red `absent` badge would break, and it is scoped to
    // the section because the footer's legend carries `state failed` markup.
    expect(sec).not.toContain('class="state failed"')
    expect(sec).toContain('<span class="state ran">ran</span>')
  })

  it('says a stated text was not read, and why, when no reader was configured', () => {
    const html = flowReportHtml(data([step({ observations: [obs()] })]))
    const asked = askedHalfOf(html, 1)
    expect(asked).toContain('<span class="state unknown">not read</span>')
    expect(asked).toContain('no reader was configured for this run, so nothing was read')
  })

  it('never implies a text was absent on a step the flow never reached', () => {
    const html = flowReportHtml(data([step({ status: 'failed', error: 'no such element' }), step({ status: 'not-reached', observations: [obs({ state: 'not-reached', looked: 'the flow stopped before this step' })] })]))
    const asked = askedHalfOf(html, 2)
    expect(asked).toContain('<span class="state skipped">never looked</span>')
    expect(asked).not.toContain('text not found')
  })

  it('states the no-verdict rule differently for a reading than for a bare sentence, in one document', () => {
    const html = flowReportHtml(
      data([
        step({ observations: [obs({ state: 'present', looked: 'read the whole document' })] }),
        step({ expect: 'the basket empties' }),
      ]),
    )
    // Step 1 has a reading: the line must not be a flat "does not judge this",
    // which beside `text found` reads as a shrug next to a measurement.
    const withReading = askedHalfOf(html, 1)
    expect(withReading).toContain('not whether finding it means the step was correct')
    expect(withReading).not.toContain('Obsrv does not judge this.')
    // Step 2 has only a sentence nobody measured: the original line is right.
    const bare = askedHalfOf(html, 2)
    expect(bare).toContain('Obsrv does not judge this.')
    expect(bare).not.toContain('not whether finding it means the step was correct')
  })

  it('names the passive findings it does not collect per step, rather than letting the heading imply it does', () => {
    const html = flowReportHtml(data([step()]))
    const footer = html.slice(html.indexOf('<footer'))
    expect(footer).toContain('not</b> collected per step yet')
    expect(footer).toContain('obsrv audit')
  })

  /** "Where this step ran" — scoped to the step's own section throughout, and to
   *  the `<details>` block where the claim actually lives. */
  const whereOf = (html: string, n: number): string => {
    const sec = sectionOf(html, n)
    const from = sec.indexOf('Where this step ran')
    expect(from, 'the step has no where-it-ran block').toBeGreaterThan(-1)
    return sec.slice(from)
  }

  const page = (over: Partial<FlowReportPageState> = {}): FlowReportPageState => ({
    url: 'https://shop.test/cart',
    cssWidth: 390,
    cssHeight: 844,
    deviceScaleFactor: 3,
    ...over,
  })

  it('offers the page a step ran on one click down: address, size and density', () => {
    const where = whereOf(flowReportHtml(data([step({ page: page() })])), 1)
    expect(where).toContain('https://shop.test/cart')
    expect(where).toContain('390 × 844 CSS px')
    expect(where).toContain('3×')
  })

  it('says the block is not a snapshot of the document, so four facts do not read as a truncated DOM', () => {
    expect(whereOf(flowReportHtml(data([step({ page: page() })])), 1)).toContain("Not a snapshot of the document's contents")
  })

  it('leaves out what status never reported rather than showing it as unknown', () => {
    const where = whereOf(flowReportHtml(data([step({ page: { url: 'https://shop.test/cart' } })])), 1)
    expect(where).toContain('https://shop.test/cart')
    // No invented rows: a density nobody read must not appear at all.
    expect(where).not.toContain('Density')
    expect(where).not.toContain('Size')
    expect(where).not.toContain('unknown')
  })

  it('mentions loading only when the page was still loading, not on every settled step', () => {
    const quiet = whereOf(flowReportHtml(data([step({ page: page({ loading: false }) })])), 1)
    expect(quiet).not.toContain('Loading')
    const busy = whereOf(flowReportHtml(data([step({ page: page({ loading: true }) })])), 1)
    expect(busy).toContain('still loading when this step finished')
  })

  it('offers no where-it-ran block at all for a step with no page, rather than an empty one', () => {
    const sec = sectionOf(flowReportHtml(data([step()])), 1)
    expect(sec).not.toContain('Where this step ran')
  })

  /** The network block's three states. The third — no record taken — is the one
   *  that must not borrow the second's words, so each test names which it is. */
  const netOf = (html: string, n: number): string => {
    const sec = sectionOf(html, n)
    const from = sec.indexOf('What this step asked the network for')
    expect(from, 'the step has no network block').toBeGreaterThan(-1)
    return sec.slice(from)
  }

  const net = (over: Partial<FlowReportNetwork> = {}): FlowReportNetwork => ({ records: [], dropped: 0, ...over })

  it('lists the requests a step made, with the status and the method', () => {
    const html = flowReportHtml(
      data([step({ network: net({ records: [{ method: 'POST', url: 'https://shop.test/pay', status: 201, type: 'XHR' }] }) })]),
    )
    const block = netOf(html, 1)
    expect(block).toContain('POST')
    expect(block).toContain('201')
    expect(block).toContain('XHR')
    expect(block).toContain('https://shop.test/pay')
  })

  it('says a request was in flight rather than leaving the status blank', () => {
    const html = flowReportHtml(data([step({ network: net({ records: [{ method: 'GET', url: 'https://shop.test/slow' }] }) })]))
    expect(netOf(html, 1)).toContain('in flight')
  })

  it('says a step asked for nothing, when it asked for nothing', () => {
    expect(netOf(flowReportHtml(data([step({ network: net() })])), 1)).toContain('asked for nothing over the network')
  })

  it('distinguishes no record taken from a step that made no requests', () => {
    // No `network` at all: the record could not be taken.
    const absent = netOf(flowReportHtml(data([step()])), 1)
    expect(absent).toContain('No record was taken')
    expect(absent).not.toContain('asked for nothing over the network')
    // And the reverse: an empty batch must not claim nothing was recorded.
    const empty = netOf(flowReportHtml(data([step({ network: net() })])), 1)
    expect(empty).toContain('asked for nothing over the network')
    expect(empty).not.toContain('No record was taken')
  })

  it('warns that a stopped recording is not a complete list, and does not also claim the step was quiet', () => {
    const html = flowReportHtml(data([step({ network: net({ stopped: 'the debugger session was detached' }) })]))
    const block = netOf(html, 1)
    expect(block).toContain('Recording had stopped')
    expect(block).toContain('the debugger session was detached')
    // The empty-list sentence would contradict it: nothing was recorded, so
    // "asked for nothing" is a claim nobody measured.
    expect(block).not.toContain('asked for nothing over the network')
  })

  it('names how many requests the cap left out', () => {
    const html = flowReportHtml(
      data([step({ network: net({ records: [{ method: 'GET', url: 'https://shop.test/a' }], dropped: 4 }) })]),
    )
    expect(netOf(html, 1)).toContain('4 more requests')
  })

  it('embeds the step screenshot it was given', () => {
    const html = flowReportHtml(data([step({ data: 'QUJD' })]))
    expect(html).toContain('src="data:image/png;base64,QUJD"')
  })
})
