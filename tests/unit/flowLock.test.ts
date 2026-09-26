import { describe, expect, it } from 'vitest'
import { CONTROL_FILE_ENV } from '../../src/mcp/control'
import { acquireFlowLock, flowLockPath, releaseFlowLock, type FlowLockDeps } from '../../src/mcp/flowLock'

/** An in-memory fake of the lock file plus a settable process table, so
 *  "is this pid alive" and "does createExclusive really refuse a collision"
 *  are both testable without touching a real filesystem or real processes. */
function deps(opts: { file?: string | null; alivePids?: Set<number>; now?: number } = {}): FlowLockDeps & { file: string | null } {
  const state = { file: opts.file ?? null }
  const alive = opts.alivePids ?? new Set<number>()
  return {
    get file() {
      return state.file
    },
    read: async () => state.file,
    createExclusive: async contents => {
      if (state.file !== null) throw new Error('EEXIST')
      state.file = contents
    },
    remove: async () => {
      state.file = null
    },
    isAlive: pid => alive.has(pid),
    now: () => opts.now ?? 1_700_000_000_000,
  }
}

describe('acquireFlowLock', () => {
  it('takes the lock when none exists', async () => {
    const d = deps()
    const r = await acquireFlowLock(d)
    expect(r).toEqual({ ok: true })
    expect(d.file).not.toBeNull()
    const written = JSON.parse(d.file!)
    expect(written).toEqual({ pid: process.pid, startedAt: new Date(1_700_000_000_000).toISOString() })
  })

  it('refuses when a live process holds it, naming who', async () => {
    const d = deps({
      file: JSON.stringify({ pid: 4242, startedAt: '2026-09-26T09:00:00.000Z' }),
      alivePids: new Set([4242]),
    })
    const r = await acquireFlowLock(d)
    expect(r).toEqual({ ok: false, heldBy: { pid: 4242, startedAt: '2026-09-26T09:00:00.000Z' } })
  })

  it('takes over a lock left by a dead pid, treating it as a crashed run', async () => {
    const d = deps({
      file: JSON.stringify({ pid: 4242, startedAt: '2026-09-26T09:00:00.000Z' }),
      alivePids: new Set(), // 4242 is not in it: dead
    })
    const r = await acquireFlowLock(d)
    expect(r).toEqual({ ok: true })
    const written = JSON.parse(d.file!)
    expect(written.pid).toBe(process.pid)
  })

  it('takes over a lock file that cannot be parsed at all', async () => {
    const d = deps({ file: 'not json', alivePids: new Set([4242]) })
    const r = await acquireFlowLock(d)
    expect(r).toEqual({ ok: true })
  })

  it('reports the winner when createExclusive loses a race after a stale check', async () => {
    // Simulates: we read null / stale, but by the time we call
    // createExclusive someone else has already written a live lock.
    const state = { file: null as string | null, tries: 0 }
    const d: FlowLockDeps = {
      read: async () => state.file,
      createExclusive: async () => {
        state.tries++
        // The other caller wins the race on our first attempt.
        state.file = JSON.stringify({ pid: 99, startedAt: '2026-09-26T09:05:00.000Z' })
        throw new Error('EEXIST')
      },
      remove: async () => {
        state.file = null
      },
      isAlive: () => true,
      now: () => 1_700_000_000_000,
    }
    const r = await acquireFlowLock(d)
    expect(r).toEqual({ ok: false, heldBy: { pid: 99, startedAt: '2026-09-26T09:05:00.000Z' } })
    expect(state.tries).toBe(1)
  })
})

describe('releaseFlowLock', () => {
  it('removes the lock', async () => {
    const d = deps({ file: JSON.stringify({ pid: process.pid, startedAt: 'x' }) })
    await releaseFlowLock(d)
    expect(d.file).toBeNull()
  })
})

describe('flowLockPath', () => {
  it("lives beside control.json's own directory, as its own file", () => {
    const prior = process.env[CONTROL_FILE_ENV]
    process.env[CONTROL_FILE_ENV] = '/tmp/obsrv-test-profile/control.json'
    try {
      expect(flowLockPath()).toBe('/tmp/obsrv-test-profile/flow-lock.json')
    } finally {
      if (prior === undefined) delete process.env[CONTROL_FILE_ENV]
      else process.env[CONTROL_FILE_ENV] = prior
    }
  })
})
