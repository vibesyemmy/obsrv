import { describe, it, expect, vi, afterEach } from 'vitest'
import { ensureLive, type Discovery, type EnsureDeps } from '../../src/mcp/control'
import { DECLINED_NOTE, LAUNCH_TIMEOUT_MS, type LivePlan } from '../../src/mcp/lib'
import type { LiveApp } from '../../src/mcp/control'

const app = { info: { port: 1, token: 'a'.repeat(64) }, status: { url: 'https://x.test' } } as unknown as LiveApp
const LIVE: LivePlan = { path: 'live', notes: ['n'] }

function deps(sequence: Discovery[], launch: EnsureDeps['launch'] = () => undefined): EnsureDeps & { clock: number } {
  let t = 0
  const d = {
    clock: 0,
    discover: vi.fn(async () => sequence.shift() ?? ({ kind: 'absent' } as Discovery)),
    launch: vi.fn(launch),
    sleep: vi.fn(async (ms: number) => {
      t += ms
    }),
    now: () => t,
  }
  return d
}

describe('ensureLive', () => {
  it('a headless plan is returned as it is; nothing is discovered or launched', async () => {
    const d = deps([])
    const r = await ensureLive({ path: 'headless', why: 'requested', notes: [] }, d)
    expect(r).toEqual({ path: 'headless', why: 'requested', notes: [] })
    expect(d.discover).not.toHaveBeenCalled()
  })
  it('a live app is used as found', async () => {
    const d = deps([{ kind: 'live', app }])
    expect(await ensureLive(LIVE, d)).toEqual({ path: 'live', app, launched: false, notes: ['n'] })
    expect(d.launch).not.toHaveBeenCalled()
  })
  it('declined: headless, the note says who to ask, and nothing is launched', async () => {
    const d = deps([{ kind: 'declined', pid: 4 }])
    expect(await ensureLive(LIVE, d)).toEqual({ path: 'headless', why: 'declined', notes: ['n', DECLINED_NOTE] })
    expect(d.launch).not.toHaveBeenCalled()
  })
  it('absent: launches, waits, and uses the app once it answers — launched is true', async () => {
    const d = deps([{ kind: 'absent' }, { kind: 'absent' }, { kind: 'live', app }])
    const r = await ensureLive(LIVE, d)
    expect(d.launch).toHaveBeenCalledTimes(1)
    expect(r).toEqual({ path: 'live', app, launched: true, notes: ['n'] })
  })
  it('absent, then the user declines in the consent bar: headless, declined', async () => {
    const d = deps([{ kind: 'absent' }, { kind: 'declined', pid: 4 }])
    expect(await ensureLive(LIVE, d)).toMatchObject({ path: 'headless', why: 'declined' })
  })
  it('absent and it never comes up: launch-timeout, and the note says how long it waited', async () => {
    const d = deps([])
    const r = await ensureLive(LIVE, d)
    expect(r).toMatchObject({ path: 'headless', why: 'launch-timeout' })
    expect(r.notes.join(' ')).toMatch(new RegExp(`${LAUNCH_TIMEOUT_MS / 1000} s`))
  })
  it("nothing to launch: launch-timeout with the launcher's reason", async () => {
    const d = deps([{ kind: 'absent' }], () => {
      throw new Error('no Obsrv.app anywhere')
    })
    const r = await ensureLive(LIVE, d)
    expect(r).toMatchObject({ path: 'headless', why: 'launch-timeout' })
    expect(r.notes.join(' ')).toMatch(/no Obsrv\.app anywhere/)
  })

  // The gate that matters most: cannotLaunchReason's inputs (env, platform)
  // must reach ensureLive, and must be consulted only on the branch that is
  // about to launch — never on a live or declined discovery. This is what
  // stands between a test run of this very harness and a stray Obsrv window
  // against the developer's own profile: OBSRV_TEST=1, absent discovery,
  // launch must never be called.
  describe('the launch gate (cannotLaunch)', () => {
    afterEach(() => {
      vi.unstubAllEnvs()
    })

    it('OBSRV_TEST=1 with the real cannotLaunch (no override): headless/no-display, launch is never called', async () => {
      vi.stubEnv('OBSRV_TEST', '1')
      const d = deps([{ kind: 'absent' }])
      const r = await ensureLive(LIVE, d)
      expect(r).toMatchObject({ path: 'headless', why: 'no-display' })
      expect(r.notes.join(' ')).toMatch(/OBSRV_TEST/)
      expect(d.launch).not.toHaveBeenCalled()
    })

    it('an injected cannotLaunch is consulted before launching an absent app', async () => {
      const d = deps([{ kind: 'absent' }]) as EnsureDeps & { clock: number }
      d.cannotLaunch = vi.fn(() => 'a made-up reason')
      const r = await ensureLive(LIVE, d)
      expect(r).toMatchObject({ path: 'headless', why: 'no-display' })
      expect(r.notes.join(' ')).toMatch(/a made-up reason/)
      expect(d.launch).not.toHaveBeenCalled()
      expect(d.cannotLaunch).toHaveBeenCalledTimes(1)
    })

    it('cannotLaunch is not consulted when the app is already live', async () => {
      const d = deps([{ kind: 'live', app }]) as EnsureDeps & { clock: number }
      d.cannotLaunch = vi.fn(() => 'would refuse if asked')
      expect(await ensureLive(LIVE, d)).toEqual({ path: 'live', app, launched: false, notes: ['n'] })
      expect(d.cannotLaunch).not.toHaveBeenCalled()
    })

    it('cannotLaunch is not consulted when the app is declined', async () => {
      const d = deps([{ kind: 'declined', pid: 4 }]) as EnsureDeps & { clock: number }
      d.cannotLaunch = vi.fn(() => 'would refuse if asked')
      expect(await ensureLive(LIVE, d)).toEqual({ path: 'headless', why: 'declined', notes: ['n', DECLINED_NOTE] })
      expect(d.cannotLaunch).not.toHaveBeenCalled()
    })

    it('a null cannotLaunch (nothing in the way) still launches as normal', async () => {
      const d = deps([{ kind: 'absent' }, { kind: 'live', app }]) as EnsureDeps & { clock: number }
      d.cannotLaunch = vi.fn(() => null)
      const r = await ensureLive(LIVE, d)
      expect(d.launch).toHaveBeenCalledTimes(1)
      expect(r).toEqual({ path: 'live', app, launched: true, notes: ['n'] })
    })
  })
})
