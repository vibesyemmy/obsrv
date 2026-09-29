import { describe, expect, it } from 'vitest'
import { flowRunnerDeps } from '../../src/mcp/flowTool'

/**
 * That a reader is supplied at all.
 *
 * **Bought by a defect that shipped.** `FlowRunnerDeps.observe` is optional;
 * `#482` landed `observeViaControl`; and for a while **nothing passed it**, so
 * every stated expectation in every flow report read `unknown — no reader was
 * configured for this run, so nothing was read`. The feature's central sentence
 * — *the text you expected is there, or it is not* — was unreachable, and no
 * test could notice, because the wiring lived in a closure inside `server.ts`
 * that no unit test can reach. `flowRunnerDeps` exists so this file can.
 *
 * These assert the join, not the reader: `flowObserve.test.ts` covers what
 * `observeViaControl` does with a reply.
 */
describe('the runner dependencies the MCP tool builds', () => {
  it('supplies a reader, so a stated expectation is not unknown for want of one', () => {
    const deps = flowRunnerDeps(async () => ({ ok: true }))
    // The precise thing that was missing. `toBeDefined` rather than a truthiness
    // check: the defect was an absent key, and `observe` is a function either
    // way, so a loose assertion would have passed on the broken build.
    expect(deps.observe).toBeDefined()
    expect(typeof deps.observe).toBe('function')
  })

  it('reads through the control call it was given, on the observeText command', async () => {
    const sent: Array<{ command: string; payload?: Record<string, unknown> }> = []
    const deps = flowRunnerDeps(async (command, payload) => {
      sent.push({ command, ...(payload !== undefined ? { payload } : {}) })
      // A reply the reader's own checks accept, with no findings: enough to get
      // past parsing, since what the reader makes of a reply is its own test's
      // subject rather than this one's. `viewport` and `truncated` are required
      // by `parseObserveReport` — the first version of this stub omitted
      // `viewport` and the reader refused it, which is the refusal working.
      return { ok: true, viewport: { width: 390, height: 844 }, findings: [], truncated: { matches: 0, unrendered: 0 } }
    })
    await deps.observe!(['Order confirmed'])
    // One call, and it names the command rather than some near neighbour: the
    // whole failure mode here is a reader wired to nothing, or to the wrong
    // thing, and both look identical from the step's `unknown`.
    expect(sent.map(s => s.command)).toEqual(['observeText'])
    expect(sent[0]!.payload).toEqual({ texts: ['Order confirmed'] })
  })

  it('passes the same call through for the steps themselves', async () => {
    const commands: string[] = []
    const deps = flowRunnerDeps(async command => {
      commands.push(command)
      return { ok: true }
    })
    await deps.call('reload')
    expect(commands).toEqual(['reload'])
  })
})
