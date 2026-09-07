import { describe, it, expect, vi } from 'vitest'
import { launchApp, resolveLaunchTarget } from '../../src/mcp/launch'

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

describe('launchApp', () => {
  it('spawns detached with agent control force-enabled, and lets go of the child', () => {
    const unref = vi.fn()
    const spawn = vi.fn(() => ({ unref }))
    launchApp({ kind: 'bundle', executable: '/A/Obsrv' }, { HOME: '/Users/x' }, spawn as never)
    expect(spawn).toHaveBeenCalledWith('/A/Obsrv', [], expect.objectContaining({ detached: true, stdio: 'ignore', env: expect.objectContaining({ OBSRV_AGENT_CONTROL: '1' }) }))
    expect(unref).toHaveBeenCalled()
  })
  it('electron target: the entry is the first argument, and ELECTRON_RUN_AS_NODE is cleared', () => {
    const spawn = vi.fn(() => ({ unref: () => undefined }))
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
})
