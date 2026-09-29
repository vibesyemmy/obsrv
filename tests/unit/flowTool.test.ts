import { describe, expect, it } from 'vitest'
import { flowReportSteps, flowSubject, runFlowTool, type FlowToolDeps } from '../../src/mcp/flowTool'
import type { Flow } from '../../src/shared/flow'
import type { FlowRunResult, StartFlowResult } from '../../src/mcp/flowRunner'

/**
 * The join between the three pieces, which is the thing neither of the first
 * two cards could test: validation, a held session, and a document. Every dep
 * is injected, so none of this needs an app, a control server or a lock file.
 */
const deps = (over: Partial<FlowToolDeps> & { result?: FlowRunResult; refused?: true } = {}): FlowToolDeps & { html: string[] } => {
  const html: string[] = []
  const d = {
    html,
    start: async (): Promise<StartFlowResult> =>
      over.refused === true
        ? { ok: false, refused: { heldBy: { pid: 4242, startedAt: '2026-09-28T10:00:00Z' }, ageMs: 40_000 } }
        : { ok: true, result: over.result ?? { steps: [{ index: 0, action: 'navigate', status: 'ran', settled: true }] } },
    writeReport: async (h: string) => {
      html.push(h)
      return '/tmp/obsrv-mcp-x/flow.html'
    },
    now: () => '2026-09-28T11:00:00Z',
    version: '0.62.1',
    ...over,
  }
  return d as FlowToolDeps & { html: string[] }
}

describe('runFlowTool: a flow given in words', () => {
  /**
   * The resolver's surface. `flowLanguage.ts` shipped in `#491` with nothing
   * importing it — real and unreachable — and this is the join that makes it
   * reachable. The resolver itself is tested on its own; these check the wiring
   * and the refusals, which is where a half-resolved flow would leak through.
   */
  it('resolves a description into steps and runs them', async () => {
    const d = deps({
      result: {
        steps: [
          { index: 0, action: 'navigate', status: 'ran', settled: true },
          { index: 1, action: 'audit', status: 'ran', settled: true },
        ],
      },
    })
    const out = await runFlowTool({ description: 'go to https://shop.test, then audit' }, d)
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.steps.map(x => x.action)).toEqual(['navigate', 'audit'])
  })

  it("shows in the report what it read each clause as, so a misunderstanding is not mistaken for a broken step", async () => {
    const d = deps({ result: { steps: [{ index: 0, action: 'navigate', status: 'ran', settled: true }] } })
    await runFlowTool({ description: 'go to https://shop.test' }, d)
    const html = d.html[0]!
    expect(html).toContain('From your description')
    expect(html).toContain('go to https://shop.test')
    // The words the rule matched, not a paraphrase written beside the pattern.
    expect(html).toContain('Obsrv read it as')
  })

  it('refuses a description whose clause it cannot resolve, naming that clause, and runs nothing', async () => {
    let started = false
    const d = deps({
      start: async () => {
        started = true
        return { ok: true, result: { steps: [] } }
      },
    })
    const out = await runFlowTool({ description: 'click the checkout button' }, d)
    expect(out.ok).toBe(false)
    if (out.ok) return
    expect(out.error).toContain('click the checkout button')
    // A partial flow is worse than none: the caller would believe theirs ran.
    expect(started).toBe(false)
    expect(d.html).toEqual([])
  })

  it('refuses both forms at once rather than picking one', async () => {
    const out = await runFlowTool({ steps: [{ action: 'reload' }], description: 'reload' }, deps())
    expect(out.ok).toBe(false)
    if (out.ok) return
    expect(out.error).toContain('not both')
  })

  it('refuses neither form, naming both', async () => {
    const out = await runFlowTool({}, deps())
    expect(out.ok).toBe(false)
    if (out.ok) return
    expect(out.error).toContain('`steps`')
    expect(out.error).toContain('`description`')
  })

  it('refuses a description that is not a string, rather than resolving its stringification', async () => {
    const out = await runFlowTool({ description: 42 }, deps())
    expect(out.ok).toBe(false)
    if (out.ok) return
    expect(out.error).toContain('must be a string')
  })

  it('leaves a hand-written step list unannotated — there is no clause it came from', async () => {
    const d = deps()
    await runFlowTool({ steps: [{ action: 'reload' }] }, d)
    expect(d.html[0]!).not.toContain('From your description')
  })
})

describe('runFlowTool', () => {
  it('refuses a step list that does not validate, naming every bad step rather than the first', async () => {
    const out = await runFlowTool({ steps: [{ action: 'teleport' }, { nope: 1 }] }, deps())
    expect(out.ok).toBe(false)
    if (out.ok) return
    expect(out.error).toContain('did not validate')
    expect(out.error).toContain('teleport')
    expect(out.error).toContain('step 1')
  })

  it('writes no report when the steps do not validate', async () => {
    const d = deps()
    await runFlowTool({ steps: [{ action: 'teleport' }] }, d)
    expect(d.html).toHaveLength(0)
  })

  it('reports a refusal as nothing having run, naming who holds the app', async () => {
    const d = deps({ refused: true })
    const out = await runFlowTool({ steps: [{ action: 'navigate', target: 'https://x.test' }] }, d)
    expect(out.ok).toBe(false)
    if (out.ok) return
    expect(out.error).toContain('pid 4242')
    expect(out.error).toContain('refused rather than queued')
    // Nothing ran, so there is nothing to report on.
    expect(d.html).toHaveLength(0)
  })

  it('returns the report path and a per-step summary', async () => {
    const out = await runFlowTool({ steps: [{ action: 'navigate', target: 'https://x.test' }] }, deps())
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.reportPath).toBe('/tmp/obsrv-mcp-x/flow.html')
    expect(out.steps).toEqual([{ step: 1, action: 'navigate', status: 'ran', settled: true }])
  })

  it('carries the coverage sentence into the structured reply, not just the HTML', async () => {
    const out = await runFlowTool(
      { steps: [{ action: 'navigate', target: 'https://x.test' }, { action: 'click', target: '.pay' }, { action: 'audit' }] },
      deps({
        result: {
          steps: [
            { index: 0, action: 'navigate', status: 'ran', settled: true },
            { index: 1, action: 'click', status: 'failed', error: 'no such element' },
            { index: 2, action: 'audit', status: 'not-reached' },
          ],
        },
      }),
    )
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.coverage).toContain('never attempted')
    expect(out.coverage).toContain('step 2 failed')
  })

  it('leaves coverage null when every step was attempted and settled', async () => {
    const out = await runFlowTool({ steps: [{ action: 'navigate', target: 'https://x.test' }] }, deps())
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.coverage).toBeNull()
  })
})

describe('flowReportSteps', () => {
  const flow = (steps: Flow['steps']): Flow => ({ steps })

  it("carries a step's stated expectation onto the report", () => {
    const out = flowReportSteps(flow([{ action: 'click', target: '.pay', expect: 'the order number is visible' }]), {
      steps: [{ index: 0, action: 'click', target: '.pay', status: 'ran', settled: true }],
    })
    expect(out[0]!.expect).toBe('the order number is visible')
  })

  it('drops a non-string expectation rather than rendering an object into the page', () => {
    const out = flowReportSteps(flow([{ action: 'click', expect: { nested: true } as unknown as string }]), {
      steps: [{ index: 0, action: 'click', status: 'ran', settled: true }],
    })
    expect(out[0]!.expect).toBeUndefined()
  })

  it('zips by index, so an unattempted step keeps its own declared expectation', () => {
    const out = flowReportSteps(
      flow([
        { action: 'click', expect: 'first' },
        { action: 'audit', expect: 'second' },
      ]),
      { steps: [{ index: 0, action: 'click', status: 'failed', error: 'x' }, { index: 1, action: 'audit', status: 'not-reached' }] },
    )
    expect(out[1]!.status).toBe('not-reached')
    expect(out[1]!.expect).toBe('second')
  })
})

describe('flowSubject', () => {
  it("names the first navigation's target", () => {
    expect(flowSubject({ steps: [{ action: 'click' }, { action: 'navigate', target: 'https://shop.test' }] })).toBe('https://shop.test')
  })

  it('answers undefined when the flow never navigates, rather than a sentence', () => {
    // A sentence here became an <a href> in the report. Absence is the honest
    // answer and lets the renderer decide how to say it.
    expect(flowSubject({ steps: [{ action: 'click', target: '.pay' }] })).toBeUndefined()
  })

  it("reads a navigate's `url` as well as its `target`", () => {
    // The control server's navigate takes `url`; `target` is the field every
    // other action uses, so a first flow reaches for that. Both name the page.
    expect(flowSubject({ steps: [{ action: 'navigate', url: 'https://a.test' }] })).toBe('https://a.test')
    expect(flowSubject({ steps: [{ action: 'navigate', target: 'https://b.test' }] })).toBe('https://b.test')
  })

  it('answers undefined for a navigate that names no page at all', () => {
    expect(flowSubject({ steps: [{ action: 'navigate' }] })).toBeUndefined()
  })
})
