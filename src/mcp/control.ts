import { readFile, stat } from 'node:fs/promises'
import { request } from 'node:http'
import { homedir } from 'node:os'
import {
  controlFileModeOk,
  defaultControlFilePath,
  isDisabledStance,
  parseControlFile,
  parseControlStatus,
  type ControlInfo,
  type ControlStatus,
} from '../shared/control'
import { cannotLaunchReason, DECLINED_NOTE, LAUNCH_TIMEOUT_MS, type HeadlessPlan, type HeadlessWhy, type LivePlan } from './lib'
import { launchApp, resolveDefaultTarget } from './launch'

/**
 * MCP-side client for the app's agent-control server (spec §14 "Live
 * drive"): discovery-file lookup, liveness check, and the one-shot POST the
 * protocol speaks. Runs under plain node — the userData path is derived
 * per-platform in shared/control.ts, never asked of Electron.
 */

/**
 * Overrides where the discovery file is looked for. The e2e harness sets it
 * (its app runs with an isolated --user-data-dir, so its control.json is not
 * at the standard path); it also keeps those tests hermetic against a real
 * Obsrv the developer may have open.
 */
export const CONTROL_FILE_ENV = 'OBSRV_CONTROL_FILE'

export function controlFilePath(): string {
  return process.env[CONTROL_FILE_ENV] ?? defaultControlFilePath(process.platform, process.env, homedir())
}

/** A non-2xx answer from the control server, carrying its error message. */
export class ControlCallError extends Error {
  constructor(
    message: string,
    readonly statusCode?: number,
  ) {
    super(message)
  }
}

/**
 * One control-protocol command. Rejects on transport failure, timeout, or a
 * non-200 answer (with the server's error message when it sent one).
 */
export function controlCall(
  info: ControlInfo,
  command: string,
  payload: Record<string, unknown> = {},
  timeoutMs = 10_000,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ token: info.token, command, payload })
    const req = request(
      {
        host: '127.0.0.1',
        port: info.port,
        method: 'POST',
        path: '/',
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
        timeout: timeoutMs,
      },
      res => {
        let text = ''
        res.on('data', d => (text += String(d)))
        res.on('end', () => {
          let parsed: unknown = null
          try {
            parsed = JSON.parse(text)
          } catch {
            // Handled by the shape check below.
          }
          const rec = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {}
          if (res.statusCode === 200) {
            resolve(rec)
          } else {
            const detail = typeof rec['error'] === 'string' ? rec['error'] : `control server answered ${res.statusCode ?? '?'}`
            reject(new ControlCallError(`obsrv control ${command}: ${detail}`, res.statusCode))
          }
        })
      },
    )
    req.on('timeout', () => req.destroy(new Error(`obsrv control ${command} timed out after ${timeoutMs} ms`)))
    req.on('error', reject)
    req.end(body)
  })
}

export interface LiveApp {
  info: ControlInfo
  status: ControlStatus
}

export type Discovery = { kind: 'live'; app: LiveApp } | { kind: 'declined'; pid: number } | { kind: 'absent' }

/**
 * What the discovery file says, in three words. `live`: a control-enabled app
 * answered `status`. `declined`: an app is running and control is off — ask
 * in the app, do not launch over it. `absent`: no file, a dead owner, or a
 * live file whose server does not answer (a crashed run's leftover).
 */
export async function discover(timeoutMs = 500): Promise<Discovery> {
  const file = controlFilePath()
  let raw: string
  try {
    const s = await stat(file)
    if (!controlFileModeOk(s.mode, process.platform)) return { kind: 'absent' }
    raw = await readFile(file, 'utf8')
  } catch {
    return { kind: 'absent' }
  }
  const info = parseControlFile(raw)
  if (!info) return { kind: 'absent' }
  // A stamped file whose writer is gone is a crashed run's leftover, not an
  // app: say so without knocking on a port nobody listens to. EPERM means
  // the process exists but belongs to someone else, which is still alive.
  if (info.pid !== undefined) {
    try {
      process.kill(info.pid, 0)
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ESRCH') return { kind: 'absent' }
    }
  }
  if (isDisabledStance(info)) return { kind: 'declined', pid: info.pid }
  try {
    const status = parseControlStatus(await controlCall(info, 'status', {}, timeoutMs))
    return status ? { kind: 'live', app: { info, status } } : { kind: 'absent' }
  } catch {
    return { kind: 'absent' }
  }
}

/**
 * The old shape, for callers that only care whether an app is live and
 * reachable — every existing `obsrv_*` tool handler in server.ts calls this
 * and treats `null` as "not reachable", which `declined` and `absent` both
 * still are.
 */
export async function discoverControl(timeoutMs = 500): Promise<LiveApp | null> {
  const d = await discover(timeoutMs)
  return d.kind === 'live' ? d.app : null
}

export type LiveResolution =
  | { path: 'live'; app: LiveApp; launched: boolean; notes: string[] }
  | { path: 'headless'; why: HeadlessWhy; notes: string[] }

export interface EnsureDeps {
  discover: () => Promise<Discovery>
  /** Throws (or rejects) with a message when nothing can be launched. */
  launch: () => void | Promise<void>
  sleep: (ms: number) => Promise<void>
  now: () => number
  /**
   * Whether a launch attempt could ever succeed right now (`cannotLaunchReason`,
   * src/mcp/lib.ts) — null if it could. Optional: a caller that only wants to
   * fake discover/launch/sleep/now (as every test in mcpControl.test.ts does)
   * can omit it, and it falls back to checking the real `process.env` and
   * `process.platform`, same as omitting `deps` entirely. Broken out as its
   * own dependency, rather than folded into `launch`, so a test can assert
   * "launch was never called" *because* this refused, without needing
   * `launch` itself to know about the gate.
   */
  cannotLaunch?: () => string | null
}

const LAUNCH_POLL_MS = 250

const realCannotLaunch = (): string | null => cannotLaunchReason(process.env, process.platform)

const defaultDeps: EnsureDeps = {
  discover: () => discover(),
  launch: () => {
    const target = resolveDefaultTarget()
    if ('error' in target) throw new Error(target.error)
    launchApp(target, process.env)
  },
  sleep: ms => new Promise(r => setTimeout(r, ms)),
  now: () => Date.now(),
  cannotLaunch: realCannotLaunch,
}

/**
 * Gets to the live app or says why not (live-first spec §2). A headless plan
 * passes straight through. Otherwise: use a live app; respect a declined
 * one; launch an absent one and wait — for it to answer, or for the user to
 * decline in the consent bar — up to `timeoutMs`.
 *
 * Before launching, and only then, consults `cannotLaunch` (default: the
 * real `cannotLaunchReason` against `process.env`/`process.platform`): an
 * app that is already running and reachable is never refused on account of
 * SSH, a missing display, or `OBSRV_TEST=1` (see `cannotLaunchReason`'s own
 * doc comment in src/mcp/lib.ts) — only the moment this function is about to
 * spawn a brand-new one is.
 */
export async function ensureLive(plan: LivePlan | HeadlessPlan, deps: EnsureDeps = defaultDeps, timeoutMs = LAUNCH_TIMEOUT_MS): Promise<LiveResolution> {
  if (plan.path === 'headless') return plan
  const cannotLaunch = deps.cannotLaunch ?? realCannotLaunch
  const first = await deps.discover()
  if (first.kind === 'live') return { path: 'live', app: first.app, launched: false, notes: plan.notes }
  if (first.kind === 'declined') return { path: 'headless', why: 'declined', notes: [...plan.notes, DECLINED_NOTE] }
  const reason = cannotLaunch()
  if (reason !== null) {
    return {
      path: 'headless',
      why: 'no-display',
      notes: [...plan.notes, `the Obsrv app is not running and cannot be launched here (${reason}); rendered headlessly.`],
    }
  }
  try {
    await deps.launch()
  } catch (e) {
    return {
      path: 'headless',
      why: 'launch-timeout',
      notes: [...plan.notes, `the Obsrv app could not be launched (${e instanceof Error ? e.message : String(e)}); rendered headlessly.`],
    }
  }
  const deadline = deps.now() + timeoutMs
  while (deps.now() < deadline) {
    await deps.sleep(LAUNCH_POLL_MS)
    const d = await deps.discover()
    if (d.kind === 'live') return { path: 'live', app: d.app, launched: true, notes: plan.notes }
    if (d.kind === 'declined') return { path: 'headless', why: 'declined', notes: [...plan.notes, DECLINED_NOTE] }
  }
  return {
    path: 'headless',
    why: 'launch-timeout',
    notes: [...plan.notes, `the Obsrv app was launched but did not answer within ${timeoutMs / 1000} s; rendered headlessly. It may still be starting — the next call will find it.`],
  }
}
