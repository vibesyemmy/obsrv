import { join, resolve } from 'node:path'

/**
 * The dev lane, seen from the MCP server (README, "Developing: the dev lane").
 * When the obsrv-dev proxy starts this server with OBSRV_DEV=1, the app it
 * discovers and launches is this checkout's own build on the lane's profile
 * (~/.obsrv-dev/profile) — never the installed Obsrv beside it — and a dev
 * app older than the build is relaunched before a live call, so a live call
 * after `npm run build` drives the build.
 *
 * The bookkeeping is scripts/devLane.js, required from this checkout in dev
 * mode only: scripts/ is not in the package, and a release never sets the flag.
 */
export const DEV_ENV = 'OBSRV_DEV'

/** The checkout (or package) this server runs from. */
export const PACKAGE_ROOT = resolve(__dirname, '..', '..')

export interface DevLaneModule {
  controlFile(env?: NodeJS.ProcessEnv): string
  appLaunch(root: string, env?: NodeJS.ProcessEnv): { entry: string; args: string[]; env: Record<string, string> }
  isStale(startedAt: string | undefined, root: string): boolean
  stopApp(pid: number, graceMs?: number): Promise<void>
  laneLabel(root: string): string
}

export function devMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[DEV_ENV] === '1'
}

let loaded: DevLaneModule | null = null

export function devLane(): DevLaneModule {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  loaded ??= require(join(PACKAGE_ROOT, 'scripts', 'devLane.js')) as DevLaneModule
  return loaded
}
