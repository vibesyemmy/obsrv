import { describe, expect, it } from 'vitest'
import type { Flow } from '../../src/shared/flow'
import { flowRefusalMessage, runFlow, startFlow, type FlowLockDeps, type FlowRunnerDeps, type ObservationReading } from '../../src/mcp/flowRunner'

function flow(steps: Flow['steps']): Flow {
  return { steps }
}

/** A box wholly inside the 390x844 viewport the stubs report, centre (140, 220). */
const ONSCREEN = { x: 100, y: 200, width: 80, height: 40 }

describe('runFlow', () => {
  it('issues every step over the same held call, in order', async () => {
    const calls: Array<{ command: string; payload: Record<string, unknown> }> = []
    const deps: Pick<FlowRunnerDeps, 'call'> = {
      call: async (command, payload = {}) => {
        calls.push({ command, payload })
        if (command === 'captureRaster') return { data: 'x', width: 1, height: 1, settled: true }
        if (command === 'status') return { cssWidth: 390, cssHeight: 844 }
        // A click by selector is resolved through `inspect` now
        // (`feat-flow-selector-click`), so a stub that answers every command with
        // `{ ok: true }` would make the step refuse for want of a match. On
        // screen and wholly inside the viewport: the plain case.
        if (command === 'inspect') return { ok: true, found: true, readout: { rect: ONSCREEN, pageRect: ONSCREEN } }
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
    // where it ran — over the same `call`, never re-resolved, never skipped. The
    // click step's own action is now three calls: locate, size the viewport,
    // press.
    expect(calls.map(c => c.command)).toEqual([
      'navigate',
      'captureRaster',
      'status',
      'networkRecord',
      'inspect', // locate the selector
      'status', // the viewport `click` is bounds-checked against
      'inspect', // **what is actually drawn at the point** — see `bug-selector-click-presses-the-gap`
      'click',
      'captureRaster',
      'status',
      'networkRecord',
    ])
    // Found by command, not by index. These were `calls[0]` and `calls[2]`, and
    // adding one call per step silently moved the second one onto the settle
    // probe — where `toEqual(...)` would have failed loudly, but the next such
    // addition might land on a call whose payload happens to match. The step's
    // own action is what these two claims are about.
    const issued = (command: string) => calls.filter(c => c.command === command).map(c => c.payload)
    expect(issued('navigate')).toEqual([{ url: 'https://x.test' }])
    // **The payload the control server has always taken**, not the step's own
    // shape: `{ target }` went out on the wire before this and 400'd one layer
    // down. The point is the centre of the box `inspect` reported.
    expect(issued('click')).toEqual([{ x: 140, y: 220 }])
    // Two inspects, and the pair is the point: the first asks *where is this
    // selector*, the second asks *what is drawn at the point we chose*. Only the
    // second can catch a box that contains points its element does not paint.
    expect(issued('inspect')).toEqual([{ selector: '.checkout' }, { x: 140, y: 220 }])
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
        // The stub answers `inspect` with no match, which is how a click by
        // selector fails now: the runner refuses before it presses anything,
        // rather than the server rejecting a payload it never should have been
        // sent (`feat-flow-selector-click`). The step still fails, which is what
        // this test is about.
        if (command === 'inspect') return { ok: true, found: false }
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
    expect(result.steps[1]).toMatchObject({ index: 1, action: 'click', status: 'failed' })
    expect(result.steps[1]!.error).toContain('no element matches ".missing"')
    expect(result.steps[2]).toEqual({ index: 2, action: 'reload', status: 'not-reached' })
    // The failed step still gets its settle probe, its `status` read and its
    // network batch (below); only the not-reached step after it is skipped. No
    // `click` went out: there was no point to send it to, and sending one anyway
    // is the behaviour this join replaced.
    expect(calls).toEqual(['navigate', 'captureRaster', 'status', 'networkRecord', 'inspect', 'captureRaster', 'status', 'networkRecord'])
    expect(calls).not.toContain('click')
  })

  it('reads the settle probe on a FAILED step too — the screen at the moment it failed distinguishes a timing problem from a settled-page defect', async () => {
    const result = await runFlow(flow([{ action: 'click', target: '.missing' }]), {
      call: async command => {
        if (command === 'inspect') return { ok: true, found: false }
        return { data: 'y', width: 1, height: 1, settled: false, unsettledReason: 'animating' }
      },
    })
    expect(result.steps[0]).toMatchObject({
      status: 'failed',
      error: expect.stringContaining('no element matches ".missing"'),
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
  const settledCall: FlowRunnerDeps['call'] = async command => {
    if (command === 'captureRaster') return { data: 'x', settled: true }
    // A click by selector goes through `inspect` and `status` now; without these
    // every step in this block would refuse for want of a match and these tests
    // would be about the refusal instead of about observations.
    if (command === 'inspect') return { ok: true, found: true, readout: { rect: ONSCREEN, pageRect: ONSCREEN } }
    if (command === 'status') return { cssWidth: 390, cssHeight: 844 }
    return { ok: true }
  }
  const reading = (over: Partial<ObservationReading> = {}): ObservationReading => ({ found: false, complete: true, looked: 'looked here', ...over })

  it("does not send observations to the step's own control command — they are the runner's, not the command's", async () => {
    const payloads: Array<Record<string, unknown>> = []
    await runFlow(flow([{ action: 'click', target: '.pay', observations: ['Order confirmed'] }]), {
      call: async (command, payload = {}) => {
        if (command === 'click') payloads.push(payload)
        if (command === 'inspect') return { ok: true, found: true, readout: { rect: ONSCREEN, pageRect: ONSCREEN } }
        if (command === 'status') return { cssWidth: 390, cssHeight: 844 }
        return command === 'captureRaster' ? { settled: true } : { ok: true }
      },
      observe: async () => [reading({ found: true })],
    })
    // The payload is the resolved point and nothing else: the selector became a
    // coordinate, and the observations — which are the runner's own business —
    // did not travel with it.
    expect(payloads).toEqual([{ x: 140, y: 220 }])
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

/**
 * Clicking a step's target by selector — the join `feat-flow-selector-click` is
 * about, at the level that sequences the calls.
 *
 * `flowClick.test.ts` covers the arithmetic and the refusal sentences. What is
 * here is the ORDER and the payloads: that an off-screen element is scrolled to
 * before it is pressed rather than refused, that nothing is pressed when there is
 * no honest point, and that what was measured is recorded either way.
 */
describe('runFlow: a click step that names a selector', () => {
  const VIEWPORT = { cssWidth: 390, cssHeight: 844 }
  /** Below the fold: page y 1200 on an 844-high viewport. */
  const BELOW = { x: 0, y: 1200, width: 200, height: 48 }

  it('scrolls an element below the fold into view and presses it, instead of refusing it', async () => {
    const calls: Array<{ command: string; payload: Record<string, unknown> }> = []
    let scrolled = false
    const result = await runFlow(flow([{ action: 'click', target: '.footer-cta' }]), {
      call: async (command, payload = {}) => {
        calls.push({ command, payload })
        if (command === 'captureRaster') return { settled: true }
        if (command === 'status') return VIEWPORT
        if (command === 'scroll') {
          scrolled = true
          return { ok: true, scrolled: { x: 0, y: 919 } }
        }
        if (command === 'inspect') {
          // Before the scroll the element is at page y 1200, off-screen; after
          // it, the same element reads at viewport y 281 — a third down, which is
          // where `scrollToShow` aimed.
          return scrolled
            ? { ok: true, found: true, readout: { rect: { ...BELOW, y: 281 }, pageRect: BELOW } }
            : { ok: true, found: true, readout: { rect: BELOW, pageRect: BELOW } }
        }
        return { ok: true }
      },
    })
    const commands = calls.map(c => c.command)
    // Locate, size the viewport, scroll, **look again**, press. The second look
    // is the load-bearing one: a scroll can land somewhere other than where it
    // was aimed, and the click is computed from where the element ended up.
    // Locate, size the viewport, scroll, **look again**, verify the point is on the
    // element, press. The second look is where a scroll that landed short shows
    // up; the third call asks what is drawn at the chosen point, which is the
    // check `bug-selector-click-presses-the-gap` bought.
    expect(commands.slice(0, 6)).toEqual(['inspect', 'status', 'scroll', 'inspect', 'inspect', 'click'])
    expect(result.steps[0]).toMatchObject({ status: 'ran' })
    const payload = (command: string) => calls.filter(c => c.command === command).map(c => c.payload)
    expect(payload('scroll')).toEqual([{ x: 0, y: Math.round(1200 - 844 / 3) }])
    expect(payload('click')).toEqual([{ x: 100, y: 305 }])
    // And the record says a scroll was needed, which an element pressed where it
    // stood would not carry.
    expect(result.steps[0]!.resolved).toMatchObject({ selector: '.footer-cta', scrolledTo: { x: 0, y: 919 }, point: { x: 100, y: 305 } })
  })

  it('does not scroll an element that is already on screen, and records that it did not', async () => {
    const calls: string[] = []
    const result = await runFlow(flow([{ action: 'click', target: '.buy' }]), {
      call: async command => {
        calls.push(command)
        if (command === 'captureRaster') return { settled: true }
        if (command === 'status') return VIEWPORT
        if (command === 'inspect') return { ok: true, found: true, readout: { rect: ONSCREEN, pageRect: ONSCREEN } }
        return { ok: true }
      },
    })
    expect(calls).not.toContain('scroll')
    // Absence of the key is the fact: it says the element was pressed where it
    // stood, which a reader of the report needs to distinguish from a scroll of
    // zero.
    expect(result.steps[0]!.resolved!.scrolledTo).toBeUndefined()
    expect(result.steps[0]!.resolved!.point).toEqual({ x: 140, y: 220 })
  })

  it('refuses a zero-size element by name, presses nothing, and keeps the box it measured', async () => {
    const calls: string[] = []
    const result = await runFlow(flow([{ action: 'click', target: '#none' }]), {
      call: async command => {
        calls.push(command)
        if (command === 'captureRaster') return { settled: true }
        if (command === 'status') return VIEWPORT
        if (command === 'inspect') {
          return {
            ok: true,
            found: true,
            readout: { rect: { x: 0, y: 0, width: 0, height: 0 }, pageRect: { x: 0, y: 0, width: 0, height: 0 } },
            // The shape the live reply has: the rule lives in a note, not a field.
            notes: ['this element is not drawn: display: none on it or on an ancestor.'],
          }
        }
        return { ok: true }
      },
    })
    expect(calls).not.toContain('click')
    expect(result.steps[0]).toMatchObject({ status: 'failed' })
    expect(result.steps[0]!.error).toContain('no area')
    expect(result.steps[0]!.error).toContain('display: none')
    // The measurement that produced the refusal is kept, because it is the fact
    // that explains it — a reader should not have to re-run the flow to see the
    // box was 0x0.
    expect(result.steps[0]!.resolved!.rect).toEqual({ x: 0, y: 0, width: 0, height: 0 })
  })

  it("reads a not-drawn note out of the READOUT, which is where a hit puts it", async () => {
    // **The placement is measured, not assumed** (live probe, 2026-09-29): on a
    // miss `inspect` answers `{found: false, readout: null, notes: [...]}` with
    // the notes at the top level, and on a hit the readout carries its own in
    // `readout.notes` while the top level is absent. Reading only the top level
    // is the defect the live run caught — a `display: none` button refused with a
    // bare `0x0` and named no rule at all. This test uses the hit shape
    // exclusively, so a regression to one place fails here.
    const result = await runFlow(flow([{ action: 'click', target: '#none' }]), {
      call: async command => {
        if (command === 'captureRaster') return { settled: true }
        if (command === 'status') return VIEWPORT
        if (command === 'inspect') {
          return {
            ok: true,
            found: true,
            readout: {
              rect: { x: 0, y: 0, width: 0, height: 0 },
              pageRect: { x: 0, y: 0, width: 0, height: 0 },
              notes: ['this element is not drawn: visibility: hidden in its computed style.'],
            },
          }
        }
        return { ok: true }
      },
    })
    expect(result.steps[0]!.error).toContain('visibility: hidden')
  })

  it('refuses when a scroll could not bring the element into view, naming the offset it tried', async () => {
    const result = await runFlow(flow([{ action: 'click', target: '.in-an-inner-scroller' }]), {
      call: async command => {
        if (command === 'captureRaster') return { settled: true }
        if (command === 'status') return VIEWPORT
        // The page never moves — an app shell whose scroll belongs to an inner
        // element does exactly this, and `scroll`'s own reply says so with
        // `scrolled: null`. The element stays off-screen on the second look.
        if (command === 'inspect') return { ok: true, found: true, readout: { rect: BELOW, pageRect: BELOW } }
        if (command === 'scroll') return { ok: true, scrolled: null, warnings: ['scroll offset could not be confirmed'] }
        return { ok: true }
      },
    })
    expect(result.steps[0]).toMatchObject({ status: 'failed' })
    expect(result.steps[0]!.error).toContain('still outside the 390x844 viewport after scrolling to 0,919')
    expect(result.steps[0]!.resolved).toMatchObject({ scrolledTo: { x: 0, y: 919 } })
    // Deliberately NOT a click at a clamped coordinate: there is no point inside
    // the element on screen, and pressing the nearest one would press whatever
    // else is there and report it as this element.
    expect(result.steps[0]!.resolved!.point).toBeUndefined()
  })

  it('refuses when the app reports no viewport, rather than assuming one from a preset', async () => {
    const result = await runFlow(flow([{ action: 'click', target: '.buy' }]), {
      call: async command => {
        if (command === 'captureRaster') return { settled: true }
        if (command === 'status') return { url: 'https://x.test' }
        if (command === 'inspect') return { ok: true, found: true, readout: { rect: ONSCREEN, pageRect: ONSCREEN } }
        return { ok: true }
      },
    })
    expect(result.steps[0]).toMatchObject({ status: 'failed' })
    expect(result.steps[0]!.error).toContain('did not report a viewport size')
  })

  it('carries a button through to the resolved click, since the step may name one', async () => {
    const payloads: Array<Record<string, unknown>> = []
    await runFlow(flow([{ action: 'click', target: '.buy', button: 'right' }]), {
      call: async (command, payload = {}) => {
        if (command === 'click') payloads.push(payload)
        if (command === 'captureRaster') return { settled: true }
        if (command === 'status') return VIEWPORT
        if (command === 'inspect') return { ok: true, found: true, readout: { rect: ONSCREEN, pageRect: ONSCREEN } }
        return { ok: true }
      },
    })
    expect(payloads).toEqual([{ button: 'right', x: 140, y: 220 }])
  })

  it('leaves a click that already names coordinates exactly as it was', async () => {
    const calls: Array<{ command: string; payload: Record<string, unknown> }> = []
    await runFlow(flow([{ action: 'click', x: 10, y: 20 }]), {
      call: async (command, payload = {}) => {
        calls.push({ command, payload })
        return command === 'captureRaster' ? { settled: true } : { ok: true }
      },
    })
    // No `inspect`: there is nothing to resolve, and adding a round-trip to a
    // step that was already complete would change timing for every existing flow.
    expect(calls.map(c => c.command)).toEqual(['click', 'captureRaster', 'status', 'networkRecord'])
    expect(calls[0]!.payload).toEqual({ x: 10, y: 20 })
  })
})

describe('runFlow: a type step — resolution, refusals, and the masking rule', () => {
  const VIEWPORT = { cssWidth: 390, cssHeight: 844 }
  const readoutFor = (extra: Record<string, unknown>) => ({
    ok: true,
    found: true,
    readout: { rect: ONSCREEN, pageRect: ONSCREEN, editable: true, inputType: null, disabled: false, readOnly: false, ...extra },
  })

  const runType = async (step: Record<string, unknown>, readout: Record<string, unknown>) => {
    const calls: Array<{ command: string; payload: Record<string, unknown> }> = []
    const result = await runFlow(flow([{ action: 'type', target: '#field', text: 'hello', ...step }]), {
      call: async (command, payload = {}) => {
        calls.push({ command, payload })
        if (command === 'captureRaster') return { settled: true }
        if (command === 'status') return VIEWPORT
        if (command === 'inspect') return readoutFor(readout)
        return { ok: true, charsTyped: (payload.text as string | undefined)?.length ?? 0 }
      },
    })
    return { calls, result }
  }

  it('resolves by the same selector machinery as click, then dispatches type at the resolved point', async () => {
    const { calls, result } = await runType({}, {})
    expect(calls.map(c => c.command)).toEqual(['inspect', 'status', 'inspect', 'type', 'captureRaster', 'status', 'networkRecord'])
    const typeCall = calls.find(c => c.command === 'type')!
    expect(typeCall.payload).toEqual({ x: 140, y: 220, text: 'hello', append: false })
    expect(result.steps[0]).toMatchObject({ status: 'ran' })
  })

  it('passes append: true through to the control command untouched', async () => {
    const { calls } = await runType({ append: true }, {})
    expect(calls.find(c => c.command === 'type')!.payload).toMatchObject({ append: true })
  })

  it('shows the typed value normally when the element is an ordinary text field', async () => {
    const { result } = await runType({}, { inputType: 'text' })
    expect(result.steps[0]!.typed).toEqual({ length: 5, value: 'hello' })
  })

  it('masks automatically on a page-declared password field, and never carries the value', async () => {
    const { result } = await runType({}, { inputType: 'password' })
    expect(result.steps[0]!.typed).toEqual({ length: 5, maskedBecause: 'password field' })
    expect(result.steps[0]!.typed).not.toHaveProperty('value')
  })

  it('masks on secret: true even when the page does not declare a password field', () => {
    return runType({ secret: true }, { inputType: 'text' }).then(({ result }) => {
      expect(result.steps[0]!.typed).toEqual({ length: 5, maskedBecause: 'secret: true' })
    })
  })

  it('a password field is masked even if the step also carries secret: false — there is no way to unmask it from the step', async () => {
    const { result } = await runType({ secret: false }, { inputType: 'password' })
    expect(result.steps[0]!.typed).toEqual({ length: 5, maskedBecause: 'password field' })
  })

  it('length is always present and correct, masked or not', async () => {
    const shown = await runType({}, { inputType: 'text' })
    const masked = await runType({}, { inputType: 'password' })
    expect(shown.result.steps[0]!.typed!.length).toBe(5)
    expect(masked.result.steps[0]!.typed!.length).toBe(5)
  })

  it('refuses a non-editable element (a checkbox, say) without ever calling type', async () => {
    const { calls, result } = await runType({}, { editable: false, inputType: 'checkbox' })
    expect(calls).not.toContain('type')
    expect(result.steps[0]).toMatchObject({ status: 'failed' })
    expect(result.steps[0]!.error).toContain('checkbox')
    expect(result.steps[0]!.error).toContain('does not accept typed text')
    expect(result.steps[0]!.typed).toBeUndefined()
  })

  it('an app old enough to have no editable key at all refuses by naming the app, not the element', async () => {
    // No `readoutFor` defaults here — this is the wire shape an app built
    // before `feat-flow-type-text` actually sends: no `editable`/`inputType`/
    // `disabled`/`readOnly` keys at all, not any of them present-but-false.
    const calls: Array<{ command: string; payload: Record<string, unknown> }> = []
    const result = await runFlow(flow([{ action: 'type', target: '#field', text: 'hello' }]), {
      call: async (command, payload = {}) => {
        calls.push({ command, payload })
        if (command === 'captureRaster') return { settled: true }
        if (command === 'status') return VIEWPORT
        if (command === 'inspect') return { ok: true, found: true, readout: { rect: ONSCREEN, pageRect: ONSCREEN } }
        return { ok: true, charsTyped: 0 }
      },
    })
    expect(calls.map(c => c.command)).not.toContain('type')
    expect(result.steps[0]).toMatchObject({ status: 'failed' })
    // Names the true cause (the app's age) rather than a false one (the
    // element's kind) — the distinction Henry's review of #530 asked for.
    expect(result.steps[0]!.error).toContain('this app does not report whether an element accepts typed text')
    expect(result.steps[0]!.error).toContain('predates the field')
    expect(result.steps[0]!.error).not.toContain('does not accept typed text')
  })

  it('refuses a disabled element without calling type', async () => {
    const { calls, result } = await runType({}, { disabled: true })
    expect(calls.map(c => c.command)).not.toContain('type')
    expect(result.steps[0]!.error).toContain('disabled')
  })

  it('refuses a read-only element without calling type', async () => {
    const { calls, result } = await runType({}, { readOnly: true })
    expect(calls.map(c => c.command)).not.toContain('type')
    expect(result.steps[0]!.error).toContain('read-only')
  })

  it('an unresolved selector fails the same way click’s does, before any editability check', async () => {
    const calls: string[] = []
    const result = await runFlow(flow([{ action: 'type', target: '#gone', text: 'x' }]), {
      call: async command => {
        calls.push(command)
        if (command === 'captureRaster') return { settled: true }
        if (command === 'status') return VIEWPORT
        if (command === 'inspect') return { ok: true, found: false, notes: [] }
        return { ok: true }
      },
    })
    expect(calls).not.toContain('type')
    expect(result.steps[0]!.error).toContain('no element matches')
  })
})

/**
 * The wrapped-inline case, at the level that sequences the calls.
 *
 * `bug-selector-click-presses-the-gap`, found on the first real drive of 0.63.0: a click by selector
 * pressed the centre of a link's border box, which for a two-line link is the leading between its line
 * boxes — the parent block's paint. The press landed on an `<h3>`, the step reported `ran`, and the
 * flow described a journey it never made.
 *
 * The stubs here model the page the way the browser answers it: `inspect {selector}` gives the union
 * box; `inspect {at}` gives whatever is drawn at that point — the `<h3>` in the gap, the `<a>` inside a
 * line.
 */
describe('runFlow: a click whose element does not paint its own box centre', () => {
  const VIEWPORT = { cssWidth: 390, cssHeight: 844 }
  /** The measured geometry: two 17px lines with a 3px gap, union 36.5px tall. */
  const LINK = { x: 77.6, y: 266.8, width: 77.3, height: 36.5 }
  const GAP = { top: LINK.y + 17, bottom: LINK.y + 20 }
  const H3 = { x: 60, y: 265.3, width: 112.5, height: 40 }

  const page =
    (onHit: (p: { x: number; y: number }) => 'a' | 'h3') =>
    async (command: string, payload: Record<string, unknown> = {}): Promise<Record<string, unknown>> => {
      if (command === 'captureRaster') return { settled: true }
      if (command === 'status') return VIEWPORT
      if (command === 'inspect') {
        if (payload['x'] !== undefined) {
          const p = payload as unknown as { x: number; y: number }
          return onHit(p) === 'a'
            ? { ok: true, found: true, readout: { rect: LINK, pageRect: LINK, element: 'a' } }
            : { ok: true, found: true, readout: { rect: H3, pageRect: H3, element: 'h3' } }
        }
        return { ok: true, found: true, readout: { rect: LINK, pageRect: LINK, element: 'a' } }
      }
      return { ok: true }
    }

  /** The page as measured: the gap answers `h3`, everything else in the box answers `a`. */
  const wrapped = (p: { x: number; y: number }): 'a' | 'h3' => (p.y >= GAP.top && p.y <= GAP.bottom ? 'h3' : 'a')

  it('presses a point the element actually paints, not the centre of its box', async () => {
    const payloads: Array<Record<string, unknown>> = []
    const result = await runFlow(flow([{ action: 'click', target: '.product_pod h3 a' }]), {
      call: async (command, payload = {}) => {
        if (command === 'click') payloads.push(payload)
        return page(wrapped)(command, payload)
      },
    })
    expect(result.steps[0], JSON.stringify(result.steps[0]?.error)).toMatchObject({ status: 'ran' })
    const pressed = payloads[0] as { x: number; y: number }
    // The centre would be y=285, inside the gap. Whatever it chose, it must not be.
    expect(pressed.y >= GAP.top && pressed.y <= GAP.bottom, `pressed ${pressed.y}, which is in the inter-line gap`).toBe(false)
  })

  it('refuses, rather than reporting ran, when no point inside the box resolves to the element', async () => {
    // A box whose every point answers something else — the failure mode this card
    // is about, with the recovery removed.
    const result = await runFlow(flow([{ action: 'click', target: '.product_pod h3 a' }]), {
      call: async (command, payload = {}) => page(() => 'h3')(command, payload),
    })
    expect(result.steps[0]).toMatchObject({ status: 'failed' })
    expect(result.steps[0]!.error).toContain('no point inside it')
    expect(result.steps[0]!.error).toContain('h3')
  })

  it('refuses, and presses nothing, when the check itself cannot run', async () => {
    const payloads: Array<Record<string, unknown>> = []
    const result = await runFlow(flow([{ action: 'click', target: '.buy' }]), {
      call: async (command, payload = {}) => {
        if (command === 'click') payloads.push(payload)
        if (command === 'inspect' && payload['x'] !== undefined) throw new Error('inspect is unavailable')
        return page(wrapped)(command, payload)
      },
    })
    // **The first version pressed anyway**, on the reasoning that the probe is not
    // the product — and that swallowed a 400 from sending the wrong payload shape,
    // so the check silently did nothing while appearing to work. "Could not check"
    // and "checked and fine" must not produce the same press.
    expect(result.steps[0]).toMatchObject({ status: 'failed' })
    expect(result.steps[0]!.error).toContain('could not check what is drawn')
    expect(payloads).toEqual([])
  })

  it('asks the control command in ITS shape — a flat point, not the MCP tool wrapper', async () => {
    // The 400 this cost an hour: `parseInspectRequest` takes `{ x, y }` at the top
    // level; `{ at: { x, y } }` is the shape the MCP tool takes, one layer up.
    const probes: Array<Record<string, unknown>> = []
    await runFlow(flow([{ action: 'click', target: '.buy' }]), {
      call: async (command, payload = {}) => {
        if (command === 'inspect' && payload['selector'] === undefined) probes.push(payload)
        return page(() => 'a')(command, payload)
      },
    })
    expect(probes).toHaveLength(1)
    expect(Object.keys(probes[0]!).sort()).toEqual(['x', 'y'])
  })

  it('costs exactly one extra call when the centre already hits, which is the common case', async () => {
    const commands: string[] = []
    await runFlow(flow([{ action: 'click', target: '.buy' }]), {
      call: async (command, payload = {}) => {
        commands.push(command)
        return page(() => 'a')(command, payload)
      },
    })
    expect(commands.filter(c => c === 'inspect')).toHaveLength(2)
  })
})

/**
 * `bug-selector-click-over-scrolls-under-text-scale`, end to end through the runner against a page that
 * obeys the physics measured on the app (probe, 2026-10-03): an element at page position P, scrolled to S
 * page px, under text scale k reads `rect.y = (P - S) * k` in surface px; `scroll` takes page px; the
 * viewport the runner checks against is the surface's.
 */
describe('runFlow: a click on an element below the fold, under a text scale', () => {
  const SURFACE = { cssWidth: 393, cssHeight: 852 }
  const P = 2216
  const PAGE_HEIGHT = 4357
  const SIZE = { width: 360, height: 56 }

  const run = async (k: number | undefined) => {
    let scroll = 0
    let recorded = 0 // what the app last landed a scroll at, which `pageRect` adds to `rect`
    const scale = k ?? 1
    const scrolls: Array<Record<string, unknown>> = []
    const presses: Array<{ x: number; y: number }> = []
    const box = () => ({ x: 30, y: (P - scroll) * scale, ...SIZE })
    const result = await runFlow(flow([{ action: 'click', target: '#below-cta' }]), {
      call: async (command, payload = {}) => {
        if (command === 'captureRaster') return { settled: true }
        if (command === 'status') return { ...SURFACE, ...(k !== undefined ? { textScale: k } : {}) }
        if (command === 'scroll') {
          scrolls.push(payload)
          // Page px, clamped to the document, and the app records where it landed.
          scroll = Math.max(0, Math.min(payload['y'] as number, PAGE_HEIGHT - SURFACE.cssHeight / scale))
          recorded = scroll
          return { ok: true, scrolled: { x: 0, y: scroll } }
        }
        if (command === 'click') {
          presses.push({ x: payload['x'] as number, y: payload['y'] as number })
          return { ok: true }
        }
        if (command === 'inspect') {
          const b = box()
          const pageRect = { ...b, y: b.y + recorded }
          if (payload['x'] !== undefined) {
            const hit = payload['x'] as number >= b.x && (payload['x'] as number) < b.x + b.width && (payload['y'] as number) >= b.y && (payload['y'] as number) < b.y + b.height
            return hit ? { ok: true, found: true, readout: { rect: b, pageRect, element: 'button' } } : { ok: true, found: true, readout: { rect: { x: 0, y: 0, width: 393, height: 852 }, pageRect, element: 'body' } }
          }
          return { ok: true, found: true, readout: { rect: b, pageRect, element: 'button' } }
        }
        return { ok: true }
      },
    })
    return { result, scrolls, presses, finalBox: box(), scale }
  }

  for (const k of [1.5, 0.75, 2, 1]) {
    it(`reaches it and presses it at a text scale of ${k}`, async () => {
      const { result, presses, finalBox } = await run(k)
      expect(result.steps[0], JSON.stringify(result.steps[0]?.error)).toMatchObject({ status: 'ran' })
      expect(presses).toHaveLength(1)
      // The press is inside the element as it stands after the scroll, in surface px.
      expect(presses[0]!.y).toBeGreaterThanOrEqual(finalBox.y)
      expect(presses[0]!.y).toBeLessThan(finalBox.y + finalBox.height)
      // And the element landed a third of the way down the surface, clear of a fixed header.
      expect(finalBox.y).toBeGreaterThan(120)
      expect(Math.abs(finalBox.y - SURFACE.cssHeight / 3)).toBeLessThanOrEqual(k)
    })
  }

  it('scrolls in page px: 1.5x the surface distance would be the bug', async () => {
    const { scrolls } = await run(1.5)
    // The element is 2216 page px down; a third of the 852 px surface is 568/3 = 189.3 page px of the 568 px
    // layout viewport. The target is therefore about 2026, not the 3040 that mixing the units produced.
    expect(scrolls).toHaveLength(1)
    expect(scrolls[0]!['y'] as number).toBeGreaterThan(2000)
    expect(scrolls[0]!['y'] as number).toBeLessThan(2100)
  })

  it('treats a status with no textScale as scale 1 — an app older than the field', async () => {
    const { result, scrolls } = await run(undefined)
    expect(result.steps[0], JSON.stringify(result.steps[0]?.error)).toMatchObject({ status: 'ran' })
    expect(scrolls[0]!['y']).toBe(Math.round(P - SURFACE.cssHeight / 3))
  })
})
