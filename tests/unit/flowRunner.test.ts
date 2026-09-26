import { describe, expect, it } from 'vitest'
import type { Flow } from '../../src/shared/flow'
import { flowRefusalMessage, runFlow, startFlow, type FlowLockDeps, type FlowRunnerDeps } from '../../src/mcp/flowRunner'

function flow(steps: Flow['steps']): Flow {
  return { steps }
}

describe('runFlow', () => {
  it('issues every step over the same held call, in order', async () => {
    const calls: Array<{ command: string; payload: Record<string, unknown> }> = []
    const deps: Pick<FlowRunnerDeps, 'call'> = {
      call: async (command, payload = {}) => {
        calls.push({ command, payload })
        if (command === 'captureRaster') return { data: 'x', width: 1, height: 1, settled: true }
        return { ok: true }
      },
    }
    const f = flow([
      { action: 'navigate', url: 'https://x.test' },
      { action: 'click', target: '.checkout' },
    ])
    const result = await runFlow(f, deps)
    expect(result.steps).toHaveLength(2)
    expect(result.steps[0]).toMatchObject({ index: 0, action: 'navigate', status: 'ran', settled: true, data: 'x' })
    expect(result.steps[1]).toMatchObject({ index: 1, action: 'click', target: '.checkout', status: 'ran', settled: true, data: 'x' })
    // Each step's own action, then one settle check, over the same `call` —
    // never re-resolved, never skipped.
    expect(calls.map(c => c.command)).toEqual(['navigate', 'captureRaster', 'click', 'captureRaster'])
    expect(calls[0]!.payload).toEqual({ url: 'https://x.test' })
    expect(calls[2]!.payload).toEqual({ target: '.checkout' })
  })

  it("records settled: false and unsettledReason when a step's settle check says so", async () => {
    const deps: Pick<FlowRunnerDeps, 'call'> = {
      call: async command =>
        command === 'captureRaster' ? { data: 'x', width: 1, height: 1, settled: false, unsettledReason: 'animating' } : { ok: true },
    }
    const result = await runFlow(flow([{ action: 'reload' }]), deps)
    expect(result.steps[0]).toMatchObject({ status: 'ran', settled: false, unsettledReason: 'animating' })
  })

  it('stops running at a step whose own action call rejects, but still records every step — later ones as not-reached', async () => {
    const calls: string[] = []
    const deps: Pick<FlowRunnerDeps, 'call'> = {
      call: async command => {
        calls.push(command)
        if (command === 'click') throw new Error('obsrv control click: no such element')
        return { ok: true, settled: true }
      },
    }
    const result = await runFlow(
      flow([{ action: 'navigate', url: 'https://x.test' }, { action: 'click', target: '.missing' }, { action: 'reload' }]),
      deps,
    )
    // Every input step gets a result — absence must never be how "not
    // attempted" is expressed, since it is indistinguishable from "not in
    // the flow" and the report's front page has to state coverage from data.
    expect(result.steps).toHaveLength(3)
    expect(result.steps[0]).toMatchObject({ status: 'ran' })
    expect(result.steps[1]).toMatchObject({ index: 1, action: 'click', status: 'failed', error: 'obsrv control click: no such element' })
    expect(result.steps[2]).toEqual({ index: 2, action: 'reload', status: 'not-reached' })
    expect(calls).toEqual(['navigate', 'captureRaster', 'click']) // reload's captureRaster and the step itself never ran
  })

  it("a settle check that itself fails does not fail the step — it just can't say", async () => {
    const deps: Pick<FlowRunnerDeps, 'call'> = {
      call: async command => {
        if (command === 'captureRaster') throw new Error('timed out')
        return { ok: true }
      },
    }
    const result = await runFlow(flow([{ action: 'reload' }]), deps)
    expect(result.steps[0]).toMatchObject({ status: 'ran' })
    expect(result.steps[0]!.settled).toBeUndefined()
    expect(result.steps[0]!.data).toBeUndefined()
  })

  it('runs an empty flow to an empty result', async () => {
    const result = await runFlow(flow([]), { call: async () => ({}) })
    expect(result.steps).toEqual([])
  })
})

function lockDeps(opts: { file?: string | null; alivePids?: Set<number> } = {}): FlowLockDeps {
  const state = { file: opts.file ?? null }
  const alive = opts.alivePids ?? new Set<number>()
  return {
    read: async () => state.file,
    createExclusive: async contents => {
      if (state.file !== null) throw new Error('EEXIST')
      state.file = contents
    },
    remove: async () => {
      state.file = null
    },
    isAlive: pid => alive.has(pid),
    now: () => 1_700_000_010_000,
  }
}

describe('startFlow', () => {
  it('runs the flow when the lock is free, and releases it afterward', async () => {
    const lock = lockDeps()
    const calls: string[] = []
    const result = await startFlow(flow([{ action: 'reload' }]), {
      call: async command => {
        calls.push(command)
        return command === 'captureRaster' ? { settled: true } : { ok: true }
      },
      lock,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')
    expect(result.result.steps).toHaveLength(1)
    expect(await lock.read()).toBeNull() // released
  })

  it('refuses loudly when a live flow already holds the lock, naming who and for how long', async () => {
    const lock = lockDeps({
      file: JSON.stringify({ pid: 4242, startedAt: '2026-09-26T09:00:00.000Z' }),
      alivePids: new Set([4242]),
    })
    const result = await startFlow(flow([{ action: 'reload' }]), {
      call: async () => ({ ok: true }),
      lock,
      now: () => Date.parse('2026-09-26T09:00:40.000Z'),
    })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected refusal')
    expect(result.refused.heldBy).toEqual({ pid: 4242, startedAt: '2026-09-26T09:00:00.000Z' })
    expect(result.refused.ageMs).toBe(40_000)
    expect(flowRefusalMessage(result.refused)).toBe(
      'a flow started 40s ago by pid 4242 holds this app; refused rather than queued, since a queued action would land at an unpredictable step boundary inside that flow.',
    )
  })

  it('releases the lock even when a step fails partway through', async () => {
    const lock = lockDeps()
    const result = await startFlow(flow([{ action: 'click', target: '.missing' }]), {
      call: async () => {
        throw new Error('no such element')
      },
      lock,
    })
    expect(result.ok).toBe(true) // startFlow succeeded at running the flow; the step itself records the failure
    if (!result.ok) throw new Error('expected ok')
    expect(result.result.steps[0]).toMatchObject({ status: 'failed' })
    expect(await lock.read()).toBeNull() // still released, not left behind by the failure
  })

  it('releases the lock even when runFlow itself throws — the case the finally exists for', async () => {
    // A step's own action rejecting is caught inside runFlow and never
    // reaches startFlow's try/finally at all (the test above exercises
    // that path, not this one). This is the genuinely unexpected throw —
    // malformed input past validateFlow's own guard — that the `finally`
    // is actually there to survive.
    const lock = lockDeps()
    const brokenFlow = { steps: null } as unknown as Flow
    await expect(startFlow(brokenFlow, { call: async () => ({ ok: true }), lock })).rejects.toThrow()
    expect(await lock.read()).toBeNull() // released despite the throw, not left held
  })

  it('does not release a lock that is no longer its own — release verifies the pid, not just "the file is gone now"', async () => {
    const lock = lockDeps()
    // A hostile/unusual deps: after runFlow completes, something else has
    // taken the lock file over (simulating it being cleared and re-acquired
    // by a different process while this flow ran).
    let handed = false
    const wrapped: FlowLockDeps = {
      ...lock,
      read: async () => {
        if (!handed) return lock.read()
        return JSON.stringify({ pid: 55555, startedAt: '2026-09-26T09:20:00.000Z' })
      },
    }
    const result = await startFlow(flow([{ action: 'reload' }]), {
      call: async command => {
        handed = true // by the time the runner finishes, someone else "owns" the file
        return command === 'captureRaster' ? { settled: true } : { ok: true }
      },
      lock: wrapped,
    })
    expect(result.ok).toBe(true)
    const raw = await wrapped.read()
    expect(raw).not.toBeNull()
    expect(JSON.parse(raw!).pid).toBe(55555) // left alone, not deleted out from under its new owner
  })
})
