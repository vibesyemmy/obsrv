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

describe('runFlowTool', () => {
  it('refuses a step list that does not validate, naming every bad step rather than the first', async () => {
    const out = await runFlowTool([{ action: 'teleport' }, { nope: 1 }], deps())
    expect(out.ok).toBe(false)
    if (out.ok) return
    expect(out.error).toContain('did not validate')
    expect(out.error).toContain('teleport')
    expect(out.error).toContain('step 1')
  })

  it('writes no report when the steps do not validate', async () => {
    const d = deps()
    await runFlowTool([{ action: 'teleport' }], d)
    expect(d.html).toHaveLength(0)
  })

  it('reports a refusal as nothing having run, naming who holds the app', async () => {
    const d = deps({ refused: true })
    const out = await runFlowTool([{ action: 'navigate', target: 'https://x.test' }], d)
    expect(out.ok).toBe(false)
    if (out.ok) return
    expect(out.error).toContain('pid 4242')
    expect(out.error).toContain('refused rather than queued')
    // Nothing ran, so there is nothing to report on.
    expect(d.html).toHaveLength(0)
  })

  it('returns the report path and a per-step summary', async () => {
    const out = await runFlowTool([{ action: 'navigate', target: 'https://x.test' }], deps())
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.reportPath).toBe('/tmp/obsrv-mcp-x/flow.html')
    expect(out.steps).toEqual([{ step: 1, action: 'navigate', status: 'ran', settled: true }])
  })

  it('carries the coverage sentence into the structured reply, not just the HTML', async () => {
    const out = await runFlowTool(
      [{ action: 'navigate', target: 'https://x.test' }, { action: 'click', target: '.pay' }, { action: 'audit' }],
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
    const out = await runFlowTool([{ action: 'navigate', target: 'https://x.test' }], deps())
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

  it('says the app already had a page open when the flow never navigates', () => {
    expect(flowSubject({ steps: [{ action: 'click', target: '.pay' }] })).toBe('the page the app already had open')
  })
})
