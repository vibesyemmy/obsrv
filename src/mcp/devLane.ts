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
  serverStamp(root: string): number
}

/** The line a dev-lane result carries: the build that answered — branch and commit, when the server was built, and where. */
export function laneStamp(label: string, builtMs: number, root: string): string {
  return `obsrv-dev lane: ${label} · server built ${new Date(builtMs).toLocaleTimeString()} · ${root}`
}

export type StampField = 'notes' | 'warnings'

/** Where a tool's result can carry the stamp: `notes` when its output schema declares them, else `warnings`, else nowhere. */
export function stampField(outputShape: Record<string, unknown> | undefined): StampField | null {
  if (outputShape === undefined) return null
  if ('notes' in outputShape) return 'notes'
  if ('warnings' in outputShape) return 'warnings'
  return null
}

/**
 * The result with the stamp appended to `field` of its structured content.
 * Structured content because Claude Code shows it and not a tool's text
 * blocks; an existing field because a client validates structured content
 * against the schema it listed, every obsrv schema refuses keys it does not
 * name, and a new key would fail every call of a session that listed the
 * tools before it existed. The lane is one pointer every session shares, so
 * this is how a session sees that another moved it. Errors, and results
 * without structured content, come back as they were.
 */
export function withStamp<T extends { structuredContent?: Record<string, unknown>; isError?: boolean }>(result: T, field: StampField, stamp: string): T {
  if (result.isError === true || result.structuredContent === undefined) return result
  const had = result.structuredContent[field]
  return { ...result, structuredContent: { ...result.structuredContent, [field]: [...(Array.isArray(had) ? had : []), stamp] } }
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
