import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CONTROL_FILE_ENV, discover, ensureLive, type Discovery, type EnsureDeps } from '../../src/mcp/control'
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
    // Hermetic default: a test that does not care about the launch gate must
    // never fall through to the real `cannotLaunchReason(process.env,
    // process.platform)` check, or it would fail under an ambient SSH
    // session or `OBSRV_TEST=1` for a reason that has nothing to do with the
    // behavior it tests (see tests/unit/mcpLib.test.ts's `DESKTOP` fixture
    // for the same discipline against `cannotLaunchReason` directly). A test
    // that wants the real check back (see 'the launch gate' below) can
    // `delete d.cannotLaunch`, since `EnsureDeps.cannotLaunch` is optional.
    cannotLaunch: (): string | null => null,
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

  // Finding 1 (final review): `not-asked` (the app is running, control is
  // off, nobody has answered anything) must be launched exactly like
  // `absent` — that launch is what hits the single-instance lock and raises
  // the consent bar (§2c). Before this fix every disabled stance read as
  // `declined`, so this branch of `ensureLive` never ran at all.
  describe('not-asked (the reachable route Finding 1 restores)', () => {
    it('launches (like absent), and once the app answers `launched` is false — it was already running', async () => {
      const d = deps([{ kind: 'not-asked', pid: 4 }, { kind: 'not-asked', pid: 4 }, { kind: 'live', app }])
      const r = await ensureLive(LIVE, d)
      expect(d.launch).toHaveBeenCalledTimes(1)
      expect(r).toEqual({ path: 'live', app, launched: false, notes: ['n'] })
    })
    it('then the user declines in the consent bar: headless, declined', async () => {
      const d = deps([{ kind: 'not-asked', pid: 4 }, { kind: 'declined', pid: 4 }])
      expect(await ensureLive(LIVE, d)).toEqual({ path: 'headless', why: 'declined', notes: ['n', DECLINED_NOTE] })
    })
    it('nobody answers: launch-timeout, and the note says Obsrv already asked — not a cold-start guess', async () => {
      let t = 0
      const d: EnsureDeps = {
        discover: vi.fn(async () => ({ kind: 'not-asked', pid: 4 }) as Discovery),
        launch: vi.fn(() => undefined),
        sleep: vi.fn(async (ms: number) => {
          t += ms
        }),
        now: () => t,
        cannotLaunch: () => null,
      }
      const r = await ensureLive(LIVE, d)
      expect(r).toMatchObject({ path: 'headless', why: 'launch-timeout' })
      expect(r.notes.join(' ')).toMatch(/asked whether to allow agent control/)
      expect(r.notes.join(' ')).toMatch(new RegExp(`${LAUNCH_TIMEOUT_MS / 1000} s`))
    })
  })

  // Finding 2 (final review): the spawned launch losing the single-instance
  // lock and exiting almost immediately is detectable (`LaunchHandle.exited`,
  // src/mcp/launch.ts), and `ensureLive` must use it to stop waiting on a
  // launch that will never come up — but only on the `absent` branch. On the
  // `not-asked` branch the same immediate exit is the *expected* delivery of
  // the knock, so it must never cut short the wait for a human to answer.
  describe('the spawned launch exiting early (Finding 2)', () => {
    it('absent, and the launch exits immediately with no app ever answering: bails promptly, not after the full timeout', async () => {
      let t = 0
      const d: EnsureDeps = {
        discover: vi.fn(async () => ({ kind: 'absent' }) as Discovery),
        launch: vi.fn(() => ({ exited: Promise.resolve() })),
        sleep: vi.fn(async (ms: number) => {
          t += ms
        }),
        now: () => t,
        cannotLaunch: () => null,
      }
      const r = await ensureLive(LIVE, d)
      expect(r).toMatchObject({ path: 'headless', why: 'launch-timeout' })
      expect(r.notes.join(' ')).toMatch(/exited immediately/)
      expect(t).toBeLessThan(LAUNCH_TIMEOUT_MS)
      expect(d.sleep).toHaveBeenCalledTimes(1)
    })
    it('absent, and the spawned process is still alive (a genuinely slow cold start): waits the full timeout, not a shortened one', async () => {
      let t = 0
      const d: EnsureDeps = {
        discover: vi.fn(async () => ({ kind: 'absent' }) as Discovery),
        launch: vi.fn(() => ({ exited: new Promise<void>(() => {}) })), // never resolves
        sleep: vi.fn(async (ms: number) => {
          t += ms
        }),
        now: () => t,
        cannotLaunch: () => null,
      }
      const r = await ensureLive(LIVE, d)
      expect(r).toMatchObject({ path: 'headless', why: 'launch-timeout' })
      expect(r.notes.join(' ')).toMatch(new RegExp(`${LAUNCH_TIMEOUT_MS / 1000} s`))
      expect(t).toBeGreaterThanOrEqual(LAUNCH_TIMEOUT_MS)
    })
    it('not-asked, and the launch exits immediately (delivering the knock): still waits the full timeout for an answer', async () => {
      let t = 0
      const d: EnsureDeps = {
        discover: vi.fn(async () => ({ kind: 'not-asked', pid: 4 }) as Discovery),
        launch: vi.fn(() => ({ exited: Promise.resolve() })),
        sleep: vi.fn(async (ms: number) => {
          t += ms
        }),
        now: () => t,
        cannotLaunch: () => null,
      }
      const r = await ensureLive(LIVE, d)
      expect(r).toMatchObject({ path: 'headless', why: 'launch-timeout' })
      expect(r.notes.join(' ')).toMatch(/asked whether to allow agent control/)
      expect(t).toBeGreaterThanOrEqual(LAUNCH_TIMEOUT_MS)
    })
    it('a launch that resolves nothing (void) behaves exactly as before: the full timeout applies', async () => {
      const d = deps([])
      const r = await ensureLive(LIVE, d)
      expect(r).toMatchObject({ path: 'headless', why: 'launch-timeout' })
      expect(r.notes.join(' ')).toMatch(new RegExp(`${LAUNCH_TIMEOUT_MS / 1000} s`))
    })
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
      // Opt back into the real cannotLaunchReason(process.env, process.platform)
      // check this test exists to prove — deps() otherwise defaults every test
      // to a hermetic no-op so it is insulated from the ambient environment.
      delete d.cannotLaunch
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

    it('cannotLaunch IS consulted for a not-asked app — it is launched exactly like absent', async () => {
      const d = deps([{ kind: 'not-asked', pid: 4 }]) as EnsureDeps & { clock: number }
      d.cannotLaunch = vi.fn(() => 'a made-up reason')
      const r = await ensureLive(LIVE, d)
      expect(r).toMatchObject({ path: 'headless', why: 'no-display' })
      expect(r.notes.join(' ')).toMatch(/a made-up reason/)
      expect(d.launch).not.toHaveBeenCalled()
      expect(d.cannotLaunch).toHaveBeenCalledTimes(1)
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

// discover() reads the real control file from disk, so these use the same
// mkdtemp-per-test + rmSync-in-afterEach convention already established by
// tests/unit/tabsFile.test.ts and tests/unit/logFile.test.ts, pointed at the
// fixture via OBSRV_CONTROL_FILE (the same env override the e2e harness uses
// — see control.ts's doc comment on CONTROL_FILE_ENV — so this never touches
// a real Obsrv the developer has open).
describe('discover', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'obsrv-mcp-control-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    vi.unstubAllEnvs()
  })

  // Finding 1 (final review): the default "control is off" stance — boot,
  // Stop, the settings toggle — must read as `not-asked`, not `declined`.
  // Before this fix every disabled stance looked declined, which made the
  // consent bar unreachable by construction (ensureLive never even tried to
  // launch). See ControlStance's doc comment in src/shared/control.ts.
  it('an app running with agent control off, never asked, reads as not-asked, carrying its pid', async () => {
    const file = join(dir, 'control.json')
    // 0600: controlFileModeOk refuses a file with any group/other bits.
    writeFileSync(file, JSON.stringify({ enabled: false, pid: process.pid }), { mode: 0o600 })
    vi.stubEnv(CONTROL_FILE_ENV, file)
    // process.pid (this very test process) is guaranteed alive, so the
    // liveness check inside discover() passes through to the stance check.
    expect(await discover()).toEqual({ kind: 'not-asked', pid: process.pid })
  })

  it('an app running with agent control off, actually declined, reads as declined, carrying its pid', async () => {
    const file = join(dir, 'control.json')
    writeFileSync(file, JSON.stringify({ enabled: false, pid: process.pid, declined: true }), { mode: 0o600 })
    vi.stubEnv(CONTROL_FILE_ENV, file)
    expect(await discover()).toEqual({ kind: 'declined', pid: process.pid })
  })

  // Finding 3 (final review): a stance whose owner crashed and whose pid the
  // OS later recycled onto an unrelated process must not pin a reader to a
  // false declined (or not-asked) forever. `process.kill(pid, 0)` alone
  // cannot tell the two apart — the cheap guard is `startedAt` against the
  // machine's own boot time (see `plausibleStance` in src/mcp/control.ts). A
  // stamp from the year 2000 predates any real boot time.
  it('a stance stamped implausibly before this boot is treated as absent, not declined', async () => {
    const file = join(dir, 'control.json')
    writeFileSync(file, JSON.stringify({ enabled: false, pid: process.pid, startedAt: '2000-01-01T00:00:00.000Z', declined: true }), { mode: 0o600 })
    vi.stubEnv(CONTROL_FILE_ENV, file)
    expect(await discover()).toEqual({ kind: 'absent' })
  })

  it('a stance stamped implausibly before this boot is treated as absent, not not-asked', async () => {
    const file = join(dir, 'control.json')
    writeFileSync(file, JSON.stringify({ enabled: false, pid: process.pid, startedAt: '2000-01-01T00:00:00.000Z' }), { mode: 0o600 })
    vi.stubEnv(CONTROL_FILE_ENV, file)
    expect(await discover()).toEqual({ kind: 'absent' })
  })

  it('a stance with no startedAt at all (an older app) is trusted — nothing to check it against', async () => {
    const file = join(dir, 'control.json')
    writeFileSync(file, JSON.stringify({ enabled: false, pid: process.pid, declined: true }), { mode: 0o600 })
    vi.stubEnv(CONTROL_FILE_ENV, file)
    expect(await discover()).toEqual({ kind: 'declined', pid: process.pid })
  })

  // NOTE: the dead-pid branch (a stamped file whose owning process has
  // exited, `process.kill` throwing ESRCH) is not covered here. Producing a
  // pid that is guaranteed absent from the process table, rather than merely
  // out of range, requires spawning a real subprocess and waiting for it to
  // exit — machinery no unit test in this repo uses (child_process appears
  // only in the Playwright e2e specs); a made-up large pid risks EINVAL
  // instead of ESRCH on some platforms, which discover() does not treat as
  // absent. Building that harness for this Minor finding was judged not
  // worth it; the branch stays covered by reading, as the original review
  // noted.
})
