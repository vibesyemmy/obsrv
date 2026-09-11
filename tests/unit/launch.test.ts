import { describe, it, expect, vi } from 'vitest'
import { launchApp, resolveDevTarget, resolveLaunchTarget } from '../../src/mcp/launch'

const ROOT = '/pkg'
const HOME = '/Users/x'

describe('resolveLaunchTarget', () => {
  it('prefers the installed bundle: the Dock icon, the update check, the user\'s own install', () => {
    const exists = (p: string): boolean => p === '/Applications/Obsrv.app/Contents/MacOS/Obsrv'
    expect(resolveLaunchTarget('darwin', HOME, ROOT, exists, () => ({ path: '/e' }))).toEqual({
      kind: 'bundle',
      executable: '/Applications/Obsrv.app/Contents/MacOS/Obsrv',
    })
  })
  it('then ~/Applications', () => {
    const exists = (p: string): boolean => p === `${HOME}/Applications/Obsrv.app/Contents/MacOS/Obsrv`
    expect(resolveLaunchTarget('darwin', HOME, ROOT, exists, () => ({ path: '/e' }))).toMatchObject({ kind: 'bundle' })
  })
  it('then the package\'s own Electron with the GUI entry', () => {
    const exists = (p: string): boolean => p === `${ROOT}/out/main/index.js`
    expect(resolveLaunchTarget('darwin', HOME, ROOT, exists, () => ({ path: '/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron' }))).toEqual({
      kind: 'electron',
      electron: '/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron',
      entry: `${ROOT}/out/main/index.js`,
    })
  })
  it('says why when nothing can be launched', () => {
    expect(resolveLaunchTarget('darwin', HOME, ROOT, () => false, () => ({ error: 'no electron' }))).toEqual({
      error: expect.stringMatching(/no Obsrv\.app.*no electron/s),
    })
  })
  it('refuses on Windows: there is no build', () => {
    expect(resolveLaunchTarget('win32', HOME, ROOT, () => true, () => ({ path: '/e' }))).toEqual({ error: expect.stringMatching(/Windows/) })
  })
})

/** A minimal fake child_process.ChildProcess: `unref` plus the `once` launchApp registers `exited` through. */
function fakeChild(): { unref: ReturnType<typeof vi.fn>; once: ReturnType<typeof vi.fn>; fire: (event: string) => void } {
  const handlers = new Map<string, () => void>()
  const once = vi.fn((event: string, cb: () => void) => handlers.set(event, cb))
  return { unref: vi.fn(), once, fire: (event: string) => handlers.get(event)?.() }
}

describe('launchApp', () => {
  it('spawns detached with agent control force-enabled, and lets go of the child', () => {
    const child = fakeChild()
    const spawn = vi.fn(() => child)
    launchApp({ kind: 'bundle', executable: '/A/Obsrv' }, { HOME: '/Users/x' }, spawn as never)
    expect(spawn).toHaveBeenCalledWith('/A/Obsrv', [], expect.objectContaining({ detached: true, stdio: 'ignore', env: expect.objectContaining({ OBSRV_AGENT_CONTROL: '1' }) }))
    expect(child.unref).toHaveBeenCalled()
  })
  it('electron target: the entry is the first argument, and ELECTRON_RUN_AS_NODE is cleared', () => {
    const spawn = vi.fn(() => fakeChild())
    launchApp({ kind: 'electron', electron: '/E', entry: '/pkg/out/main/index.js' }, { ELECTRON_RUN_AS_NODE: '1' }, spawn as never)
    const [, args, opts] = spawn.mock.calls[0] as unknown as [string, string[], { env: NodeJS.ProcessEnv }]
    expect(args).toEqual(['/pkg/out/main/index.js'])
    expect(opts.env.ELECTRON_RUN_AS_NODE).toBeUndefined()
  })
  it('never launches under the e2e harness', () => {
    const spawn = vi.fn()
    expect(() => launchApp({ kind: 'bundle', executable: '/A/Obsrv' }, { OBSRV_TEST: '1' }, spawn as never)).toThrow(/OBSRV_TEST/)
    expect(spawn).not.toHaveBeenCalled()
  })
  // Finding 2 (final review): ensureLive needs to notice a spawned process
  // that loses the single-instance lock and exits immediately, rather than
  // burning the whole launch timeout waiting on an app that will never come
  // up under this profile. `exited` is the signal it uses.
  it('exited resolves once the spawned child exits', async () => {
    const child = fakeChild()
    const spawn = vi.fn(() => child)
    const handle = launchApp({ kind: 'bundle', executable: '/A/Obsrv' }, {}, spawn as never)
    let resolved = false
    void handle.exited.then(() => (resolved = true))
    expect(resolved).toBe(false)
    child.fire('exit')
    await handle.exited
    expect(resolved).toBe(true)
  })
  it('exited also resolves on a spawn error, never rejects', async () => {
    const child = fakeChild()
    const spawn = vi.fn(() => child)
    const handle = launchApp({ kind: 'bundle', executable: '/A/Obsrv' }, {}, spawn as never)
    child.fire('error')
    await expect(handle.exited).resolves.toBeUndefined()
  })
})

describe('the dev lane target', () => {
  const lane = {
    appLaunch: (root: string) => ({ entry: root + '/out/main/index.js', args: ['--user-data-dir=/lane/profile'], env: { OBSRV_AGENT_CONTROL: '1', OBSRV_DEV_LANE: root } }),
  }
  it("runs the lane's own GUI entry on the lane's profile, never the installed bundle", () => {
    const target = resolveDevTarget('/wt', {}, () => true, () => ({ path: '/E' }), lane)
    expect(target).toEqual({
      kind: 'electron',
      electron: '/E',
      entry: '/wt/out/main/index.js',
      args: ['--user-data-dir=/lane/profile'],
      env: { OBSRV_AGENT_CONTROL: '1', OBSRV_DEV_LANE: '/wt' },
    })
  })
  it('says what is missing when the lane has no app build, or no Electron', () => {
    expect(resolveDevTarget('/wt', {}, () => false, () => ({ path: '/E' }), lane)).toEqual({ error: expect.stringMatching(/no app build at \/wt\/out\/main\/index\.js .*npm run build/) })
    expect(resolveDevTarget('/wt', {}, () => true, () => ({ error: 'electron is not installed' }), lane)).toEqual({ error: expect.stringContaining('electron is not installed') })
  })
  it('launchApp passes the profile after the entry and the lane env through, agent control still on', () => {
    const spawn = vi.fn(() => fakeChild())
    launchApp({ kind: 'electron', electron: '/E', entry: '/wt/out/main/index.js', args: ['--user-data-dir=/lane/profile'], env: { OBSRV_DEV_LANE: '/wt' } }, { HOME: '/Users/x' }, spawn as never)
    const [, args, opts] = spawn.mock.calls[0] as unknown as [string, string[], { env: NodeJS.ProcessEnv }]
    expect(args).toEqual(['/wt/out/main/index.js', '--user-data-dir=/lane/profile'])
    expect(opts.env).toMatchObject({ HOME: '/Users/x', OBSRV_DEV_LANE: '/wt', OBSRV_AGENT_CONTROL: '1' })
  })
})
