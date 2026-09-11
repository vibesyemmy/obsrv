import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * The dev lane's bookkeeping (scripts/devLane.js): where it lives, which
 * checkout it points at, how old that checkout's builds are, and how its app
 * is launched. Plain CommonJS, shared by `npm run lane`, the obsrv-dev proxy
 * and — in dev mode only — the MCP server.
 */
const lane = createRequire(__filename)('../../scripts/devLane.js') as {
  devHome(env?: NodeJS.ProcessEnv): string
  profileDir(env?: NodeJS.ProcessEnv): string
  controlFile(env?: NodeJS.ProcessEnv): string
  binDir(env?: NodeJS.ProcessEnv): string
  pointerPath(env?: NodeJS.ProcessEnv): string
  laneCheckout(env?: NodeJS.ProcessEnv): string | null
  laneTarget(env?: NodeJS.ProcessEnv): string | null
  pointLaneAt(root: string, env?: NodeJS.ProcessEnv): void
  serverStamp(root: string): number
  appStamp(root: string): number
  isStale(startedAt: string | undefined, root: string): boolean
  appLaunch(root: string, env?: NodeJS.ProcessEnv): { entry: string; args: string[]; env: Record<string, string> }
  installProxy(env?: NodeJS.ProcessEnv): string
}

const made: string[] = []
const temp = (prefix: string): string => {
  const d = mkdtempSync(join(tmpdir(), prefix))
  made.push(d)
  return d
}
afterEach(() => {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true })
})

/** A checkout with the files the lane reads: the server entry and the app's three builds. */
const checkout = (): string => {
  const root = temp('obsrv-lane-co-')
  for (const d of ['bin', 'out/mcp', 'out/main', 'out/preload', 'out/renderer']) mkdirSync(join(root, d), { recursive: true })
  for (const f of ['bin/obsrv-mcp.js', 'out/mcp/server.js', 'out/main/index.js', 'out/preload/app.js', 'out/preload/sync.js', 'out/renderer/index.html']) {
    writeFileSync(join(root, f), '')
  }
  return root
}
const stamp = (root: string, rel: string, seconds: number): void => utimesSync(join(root, rel), seconds, seconds)

describe('the dev lane', () => {
  it('lives in ~/.obsrv-dev unless OBSRV_DEV_HOME says otherwise, with its profile, pointer and proxy inside', () => {
    expect(lane.devHome({})).toBe(join(homedir(), '.obsrv-dev'))
    const env = { OBSRV_DEV_HOME: '/tmp/lane' }
    expect(lane.profileDir(env)).toBe('/tmp/lane/profile')
    expect(lane.controlFile(env)).toBe('/tmp/lane/profile/control.json')
    expect(lane.pointerPath(env)).toBe('/tmp/lane/checkout')
    expect(lane.binDir(env)).toBe('/tmp/lane/bin')
  })

  it('points at a checkout, re-points in place, and resolves to the real path', () => {
    const env = { OBSRV_DEV_HOME: temp('obsrv-lane-home-') }
    const a = checkout()
    const b = checkout()
    expect(lane.laneCheckout(env)).toBeNull()
    lane.pointLaneAt(a, env)
    expect(lane.laneCheckout(env)).toBe(realpathSync(a))
    lane.pointLaneAt(b, env)
    expect(lane.laneCheckout(env)).toBe(realpathSync(b))
    expect(lstatSync(lane.pointerPath(env)).isSymbolicLink()).toBe(true)
  })

  it('a pointer to a checkout that is gone resolves to nothing, and still says where it pointed', () => {
    const env = { OBSRV_DEV_HOME: temp('obsrv-lane-home-') }
    const gone = checkout()
    lane.pointLaneAt(gone, env)
    rmSync(gone, { recursive: true, force: true })
    expect(lane.laneCheckout(env)).toBeNull()
    expect(lane.laneTarget(env)).toBe(gone)
  })

  it('stamps the server build by its file and the app build by the newest of its three', () => {
    const root = checkout()
    stamp(root, 'out/mcp/server.js', 1000)
    stamp(root, 'out/main/index.js', 2000)
    stamp(root, 'out/preload/app.js', 3000)
    stamp(root, 'out/preload/sync.js', 1500)
    stamp(root, 'out/renderer/index.html', 2500)
    expect(lane.serverStamp(root)).toBe(1_000_000)
    expect(lane.appStamp(root)).toBe(3_000_000)
    expect(lane.serverStamp(temp('obsrv-lane-empty-'))).toBe(0)
  })

  it('an app that started before the build is stale; one that started after is not, nor one with no stamp', () => {
    const root = checkout()
    for (const f of ['out/main/index.js', 'out/preload/app.js', 'out/preload/sync.js', 'out/renderer/index.html']) stamp(root, f, 5000)
    expect(lane.isStale(new Date(4_999_000).toISOString(), root)).toBe(true)
    expect(lane.isStale(new Date(5_001_000).toISOString(), root)).toBe(false)
    expect(lane.isStale(undefined, root)).toBe(false)
  })

  it("launches the checkout's own GUI entry on the lane's profile, with agent control on and the lane named", () => {
    const root = checkout()
    const spec = lane.appLaunch(root, { OBSRV_DEV_HOME: '/tmp/lane' })
    expect(spec.entry).toBe(join(root, 'out/main/index.js'))
    expect(spec.args).toEqual(['--user-data-dir=/tmp/lane/profile'])
    expect(spec.env).toMatchObject({ OBSRV_AGENT_CONTROL: '1', OBSRV_DEV_LANE: root })
    expect(typeof spec.env.OBSRV_DEV_LANE_LABEL).toBe('string')
  })

  it('installs the proxy beside the lane, so removing a worktree cannot take obsrv-dev with it', () => {
    const env = { OBSRV_DEV_HOME: temp('obsrv-lane-home-') }
    const proxy = lane.installProxy(env)
    expect(proxy).toBe(join(env.OBSRV_DEV_HOME, 'bin', 'dev-mcp.js'))
    expect(existsSync(proxy)).toBe(true)
    expect(existsSync(join(env.OBSRV_DEV_HOME, 'bin', 'devLane.js'))).toBe(true)
  })
})
