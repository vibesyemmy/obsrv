import { describe, expect, it } from 'vitest'
import type { Flow } from '../../src/shared/flow'
import { flowRefusalMessage, runFlow, startFlow, type FlowLockDeps, type FlowRunnerDeps, type ObservationReading } from '../../src/mcp/flowRunner'

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
    // Each step's own action, then one settle check, then one `status` read for
    // where it ran — over the same `call`, never re-resolved, never skipped.
    expect(calls.map(c => c.command)).toEqual([
      'navigate',
      'captureRaster',
      'status',
      'networkRecord',
      'click',
      'captureRaster',
      'status',
      'networkRecord',
    ])
    // Found by command, not by index. These were `calls[0]` and `calls[2]`, and
    // adding one call per step silently moved the second one onto the settle
    // probe — where `toEqual({ target: '.checkout' })` would have failed loudly,
    // but the next such addition might land on a call whose payload happens to
    // match. The step's own action is what these two claims are about.
    const issued = (command: string) => calls.filter(c => c.command === command).map(c => c.payload)
    expect(issued('navigate')).toEqual([{ url: 'https://x.test' }])
    expect(issued('click')).toEqual([{ target: '.checkout' }])
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
    // The failed step still gets its settle probe, its `status` read and its
    // network batch (below); only the not-reached step after it is skipped.
    expect(calls).toEqual(['navigate', 'captureRaster', 'status', 'networkRecord', 'click', 'captureRaster', 'status', 'networkRecord'])
  })

  it('reads the settle probe on a FAILED step too — the screen at the moment it failed distinguishes a timing problem from a settled-page defect', async () => {
    const result = await runFlow(flow([{ action: 'click', target: '.missing' }]), {
      call: async command => {
        if (command === 'click') throw new Error('no such element')
        return { data: 'y', width: 1, height: 1, settled: false, unsettledReason: 'animating' }
      },
    })
    expect(result.steps[0]).toMatchObject({
      status: 'failed',
      error: 'no such element',
      settled: false,
      unsettledReason: 'animating',
      data: 'y',
    })
  })

  /**
   * Where the step ran. `status` answers from the app's own memory, so this is
   * a round-trip and not a measurement — the reason it is here per step and a
   * network record is not.
   */
  it("records the page's address, size and density as the step left it", async () => {
    const result = await runFlow(flow([{ action: 'click' }]), {
      call: async command =>
        command === 'status'
          ? { ok: true, url: 'https://shop.test/cart', cssWidth: 390, cssHeight: 844, deviceScaleFactor: 3, loading: false }
          : { settled: true },
    })
    expect(result.steps[0]!.page).toEqual({
      url: 'https://shop.test/cart',
      cssWidth: 390,
      cssHeight: 844,
      deviceScaleFactor: 3,
      loading: false,
    })
  })

  it('keeps a failed step\'s page too — the page a click failed on is the page someone has to reopen', async () => {
    const result = await runFlow(flow([{ action: 'click' }]), {
      call: async command => {
        if (command === 'click') throw new Error('no such element')
        if (command === 'status') return { url: 'https://shop.test/cart', cssWidth: 390, cssHeight: 844 }
        return { settled: true }
      },
    })
    expect(result.steps[0]).toMatchObject({ status: 'failed', page: { url: 'https://shop.test/cart' } })
  })

  it('a status that throws leaves the page absent and does not turn one failure into two', async () => {
    const result = await runFlow(flow([{ action: 'click' }]), {
      call: async command => {
        if (command === 'status') throw new Error('control gone')
        return { settled: true }
      },
    })
    expect(result.steps[0]!.page).toBeUndefined()
    // The step itself ran. A probe that cannot answer says nothing; it does not
    // fail the step, exactly as the settle probe above does not.
    expect(result.steps[0]!.status).toBe('ran')
  })

  it('carries no page key at all when status answers nothing usable, rather than an empty block', async () => {
    const result = await runFlow(flow([{ action: 'click' }]), {
      // Every field the wrong type, plus the empty string this used to keep:
      // a `url: ''` would render as a page at about:blank, which is a claim.
      call: async command => (command === 'status' ? { ok: true, url: '', cssWidth: 'wide', deviceScaleFactor: null } : { settled: true }),
    })
    expect(result.steps[0]!.page).toBeUndefined()
  })

  it('a step the flow never reached has no page, because there is no "where" for something that did not run', async () => {
    const result = await runFlow(flow([{ action: 'click' }, { action: 'reload' }]), {
      call: async command => {
        if (command === 'click') throw new Error('x')
        if (command === 'status') return { url: 'https://shop.test/cart' }
        return { settled: true }
      },
    })
    expect(result.steps[1]).toEqual({ index: 1, action: 'reload', status: 'not-reached' })
  })

  it('a not-reached step never gets a settle probe at all — nothing about it ran', async () => {
    const calls: string[] = []
    const result = await runFlow(flow([{ action: 'click' }, { action: 'reload' }]), {
      call: async command => {
        calls.push(command)
        if (command === 'click') throw new Error('x')
        return { settled: true }
      },
    })
    expect(result.steps[1]).toEqual({ index: 1, action: 'reload', status: 'not-reached' })
    // The click's own probe, status read and network batch happen; reload
    // contributes nothing at all — not its action, not a probe, not a `status`,
    // not a `networkRecord`.
    expect(calls).toEqual(['click', 'captureRaster', 'status', 'networkRecord'])
    expect(calls.filter(c => c === 'reload')).toEqual([])
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

describe('runFlow: recording what a step was expected to show', () => {
  const settledCall: FlowRunnerDeps['call'] = async command => (command === 'captureRaster' ? { data: 'x', settled: true } : { ok: true })
  const reading = (over: Partial<ObservationReading> = {}): ObservationReading => ({ found: false, complete: true, looked: 'looked here', ...over })

  it("does not send observations to the step's own control command — they are the runner's, not the command's", async () => {
    const payloads: Array<Record<string, unknown>> = []
    await runFlow(flow([{ action: 'click', target: '.pay', observations: ['Order confirmed'] }]), {
      call: async (command, payload = {}) => {
        if (command === 'click') payloads.push(payload)
        return command === 'captureRaster' ? { settled: true } : { ok: true }
      },
      observe: async () => [reading({ found: true })],
    })
    expect(payloads).toEqual([{ target: '.pay' }])
  })

  it('reads a settled step once, for all its observations in order — present with what was seen, absent when the read was complete', async () => {
    const asked: string[][] = []
    const result = await runFlow(flow([{ action: 'click', target: '.pay', observations: ['Order confirmed', 'Refund issued'] }]), {
      call: settledCall,
      observe: async texts => {
        asked.push(texts)
        return [reading({ found: true, looked: 'the own text of 40 rendered elements', saw: ['Order confirmed #1234'] }), reading({ looked: 'the own text of 40 rendered elements' })]
      },
    })
    expect(asked).toEqual([['Order confirmed', 'Refund issued']])
    expect(result.steps[0]!.observations).toEqual([
      { expected: 'Order confirmed', state: 'present', looked: 'the own text of 40 rendered elements', saw: ['Order confirmed #1234'] },
      { expected: 'Refund issued', state: 'absent', looked: 'the own text of 40 rendered elements' },
    ])
  })

  it('a string not found on an incomplete read is unknown, never absent — and the reader’s own account of the limit is kept', async () => {
    const result = await runFlow(flow([{ action: 'reload', observations: ['Order confirmed'] }]), {
      call: settledCall,
      observe: async () => [reading({ complete: false, looked: 'first 40 characters of each element; 12 were longer' })],
    })
    expect(result.steps[0]!.observations).toEqual([
      { expected: 'Order confirmed', state: 'unknown', looked: 'first 40 characters of each element; 12 were longer' },
    ])
  })

  it('a found string is present even on an incomplete read — a match is a match, only a miss depends on completeness', async () => {
    const result = await runFlow(flow([{ action: 'reload', observations: ['Order'] }]), {
      call: settledCall,
      observe: async () => [reading({ found: true, complete: false })],
    })
    expect(result.steps[0]!.observations![0]).toMatchObject({ state: 'present' })
  })

  it('a read that throws is unknown with the reason, never absent', async () => {
    const result = await runFlow(flow([{ action: 'reload', observations: ['Order confirmed'] }]), {
      call: settledCall,
      observe: async () => {
        throw new Error('the page did not answer')
      },
    })
    expect(result.steps[0]!.observations).toEqual([
      { expected: 'Order confirmed', state: 'unknown', looked: 'the read failed (the page did not answer), so nothing can be said either way' },
    ])
  })

  it('a reader that answers fewer readings than it was asked leaves the rest unknown rather than mislabelled', async () => {
    const result = await runFlow(flow([{ action: 'reload', observations: ['a', 'b'] }]), {
      call: settledCall,
      observe: async () => [reading({ found: true })],
    })
    expect(result.steps[0]!.observations![0]).toMatchObject({ expected: 'a', state: 'present' })
    expect(result.steps[0]!.observations![1]).toMatchObject({ expected: 'b', state: 'unknown', looked: expect.stringMatching(/did not answer/) })
  })

  it('an unsettled step is unknown, and is not read at all — an unfinished frame cannot honestly say something is missing', async () => {
    let read = 0
    const result = await runFlow(flow([{ action: 'reload', observations: ['Order confirmed'] }]), {
      call: async command => (command === 'captureRaster' ? { settled: false, unsettledReason: 'animating' } : { ok: true }),
      observe: async () => {
        read++
        return [reading({ found: true })]
      },
    })
    expect(read).toBe(0)
    expect(result.steps[0]!.observations).toEqual([
      { expected: 'Order confirmed', state: 'unknown', looked: 'the page had not settled (animating) when this step finished, so nothing was read' },
    ])
  })

  it("a step whose settle state could not be read is unknown too — settled is only vouched for when it was seen", async () => {
    let read = 0
    const result = await runFlow(flow([{ action: 'reload', observations: ['Order confirmed'] }]), {
      call: async command => {
        if (command === 'captureRaster') throw new Error('timed out')
        return { ok: true }
      },
      observe: async () => {
        read++
        return [reading()]
      },
    })
    expect(read).toBe(0)
    expect(result.steps[0]!.observations![0]).toMatchObject({ state: 'unknown', looked: expect.stringMatching(/settle state could not be read/) })
  })

  it("a failed step's observations are unknown and unread — what it was meant to show was not examined", async () => {
    let read = 0
    const result = await runFlow(flow([{ action: 'click', target: '.pay', observations: ['Order confirmed'] }]), {
      call: async command => {
        if (command === 'click') throw new Error('no such element')
        return { settled: true }
      },
      observe: async () => {
        read++
        return [reading({ found: true })]
      },
    })
    expect(read).toBe(0)
    expect(result.steps[0]!.observations).toEqual([
      { expected: 'Order confirmed', state: 'unknown', looked: 'the step failed, so what it was meant to show was not examined' },
    ])
  })

  it('a step never reached keeps what was expected as not-reached — never an implied absent', async () => {
    let read = 0
    const result = await runFlow(flow([{ action: 'click' }, { action: 'reload', observations: ['Order confirmed', 'Receipt sent'] }]), {
      call: async command => {
        if (command === 'click') throw new Error('x')
        return { settled: true }
      },
      observe: async () => {
        read++
        return []
      },
    })
    expect(read).toBe(0)
    expect(result.steps[1]).toEqual({
      index: 1,
      action: 'reload',
      status: 'not-reached',
      observations: [
        { expected: 'Order confirmed', state: 'not-reached', looked: 'the step was not reached, so nothing was read' },
        { expected: 'Receipt sent', state: 'not-reached', looked: 'the step was not reached, so nothing was read' },
      ],
    })
  })

  it('with no reader configured the observations are unknown — the runner does not guess a page it never read', async () => {
    const result = await runFlow(flow([{ action: 'reload', observations: ['Order confirmed'] }]), { call: settledCall })
    expect(result.steps[0]!.observations).toEqual([
      { expected: 'Order confirmed', state: 'unknown', looked: 'no reader was configured for this run, so nothing was read' },
    ])
  })

  it('a step without observations carries no observations key at all, and no read happens for it', async () => {
    let read = 0
    const result = await runFlow(flow([{ action: 'reload' }, { action: 'reload', observations: [] }]), {
      call: settledCall,
      observe: async () => {
        read++
        return []
      },
    })
    expect(read).toBe(0)
    expect('observations' in result.steps[0]!).toBe(false)
    expect('observations' in result.steps[1]!).toBe(false)
  })

  it('startFlow hands the reader through to the run', async () => {
    const lock: FlowLockDeps = {
      read: async () => null,
      createExclusive: async () => {},
      remove: async () => {},
      isAlive: () => false,
      now: () => 0,
    }
    const result = await startFlow(flow([{ action: 'reload', observations: ['Order confirmed'] }]), {
      call: settledCall,
      lock,
      observe: async () => [reading({ found: true })],
    })
    if (!result.ok) throw new Error('expected ok')
    expect(result.result.steps[0]!.observations![0]).toMatchObject({ state: 'present' })
  })
})
