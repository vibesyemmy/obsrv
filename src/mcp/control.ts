import { readFile, stat } from 'node:fs/promises'
import { request } from 'node:http'
import { homedir, uptime } from 'node:os'
import {
  controlFileModeOk,
  defaultControlFilePath,
  isDisabledStance,
  parseControlFile,
  parseControlStatus,
  type ControlInfo,
  type ControlStatus,
} from '../shared/control'
import { cannotLaunchReason, DECLINED_NOTE, DEV_RELAUNCH_NOTE, LAUNCH_TIMEOUT_MS, type HeadlessPlan, type HeadlessWhy, type LivePlan } from './lib'
import { devLane, devMode, PACKAGE_ROOT } from './devLane'
import { launchApp, resolveDefaultTarget, type LaunchHandle } from './launch'

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
  const named = process.env[CONTROL_FILE_ENV]
  if (named !== undefined) return named
  // The dev lane's app writes its file in the lane's profile, beside — never
  // instead of — the installed app's (src/mcp/devLane.ts).
  if (devMode()) return devLane().controlFile(process.env)
  return defaultControlFilePath(process.platform, process.env, homedir())
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

export type Discovery =
  | { kind: 'live'; app: LiveApp }
  | { kind: 'declined'; pid: number }
  /**
   * The app is running, control is off, and nobody has been asked anything
   * yet — the default at boot, and after Stop or the settings toggle. Unlike
   * `declined`, `ensureLive` treats this exactly like `absent`: it launches,
   * which hits the single-instance lock and raises the consent bar (spec
   * §2c). Without this state every "control is off" write looked like a
   * genuine decline and the bar was unreachable — see the final-review fix
   * for Finding 1 in
   * .superpowers/sdd/2026-09-07-live-first-agent-drive/progress.md.
   */
  | { kind: 'not-asked'; pid: number }
  | { kind: 'absent' }

/**
 * Whether a stance's `startedAt` could plausibly belong to whatever is
 * holding its `pid` right now. `process.kill(pid, 0)` only proves *something*
 * is alive there — nothing stops a crashed run's stamp surviving until the OS
 * recycles that pid onto an unrelated process, which would otherwise pin a
 * reader to a false `declined` (or `not-asked`) forever (Finding 3, final
 * review). The live/`enabled: true` path already self-heals by probing the
 * port and falling back to `absent` when nothing answers; a stance has no
 * port to probe, so it needs its own check.
 *
 * The cheapest signal available without shelling out to an OS-specific
 * process-start-time query (`ps -o lstart=` on macOS, `/proc/<pid>/stat` on
 * Linux — judged disproportionate here) is the machine's own boot time: a
 * stamp from before the last boot cannot belong to whatever holds that pid
 * today, because a reboot clears every pid. This does NOT catch a pid
 * recycled within the same boot session — rarer, but possible — and that
 * residual gap is accepted rather than silently ignored.
 */
function plausibleStance(startedAt: string | undefined): boolean {
  if (startedAt === undefined) return true // an app that predates the stamp; nothing to check against
  const started = Date.parse(startedAt)
  if (Number.isNaN(started)) return true // parseControlFile already refuses this; belt and braces
  const bootedAt = Date.now() - uptime() * 1000
  const CLOCK_SKEW_SLACK_MS = 5_000
  return started >= bootedAt - CLOCK_SKEW_SLACK_MS
}

/**
 * What the discovery file says. `live`: a control-enabled app answered
 * `status`. `declined`: the user answered an actual consent bar "Not now" —
 * ask in the app, do not launch over it. `not-asked`: the app is running,
 * control is off, and nobody has been asked — launch, same as `absent`.
 * `absent`: no file, a dead owner, a stance too old to trust (see
 * `plausibleStance`), or a live file whose server does not answer (a crashed
 * run's leftover).
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
  if (isDisabledStance(info)) {
    if (!plausibleStance(info.startedAt)) return { kind: 'absent' }
    return info.declined === true ? { kind: 'declined', pid: info.pid } : { kind: 'not-asked', pid: info.pid }
  }
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
 * and treats `null` as "not reachable", which every other `Discovery` kind
 * still is.
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
  /**
   * Throws (or rejects) with a message when nothing can be launched. May
   * resolve a `LaunchHandle` so `ensureLive` can notice the spawned process
   * exiting early (Finding 2) — a launcher that does not support this, or a
   * test double that does not care, can resolve or return nothing, which
   * falls back to the original full-timeout wait.
   */
  launch: () => void | LaunchHandle | Promise<void | LaunchHandle>
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
  /**
   * Runs once before discovery, on a live plan only; a sentence it returns
   * joins the result's notes. The dev lane's (`relaunchStaleDevApp`): a dev
   * app older than the lane's build is stopped here, so the discovery that
   * follows finds none and launches the build — `launched: true`, and the
   * sentence says why a window reopened.
   */
  prepare?: () => Promise<string | null>
}

const LAUNCH_POLL_MS = 250

/**
 * Under the dev lane, a running dev app that came up before the lane's app
 * build is stopped, so the live call that follows drives the build rather
 * than the code the app started with. Only the lane's own app is ever
 * touched: discovery under dev mode reads the lane's profile alone.
 */
async function relaunchStaleDevApp(): Promise<string | null> {
  const d = await discover()
  if (d.kind !== 'live') return null
  const { pid, startedAt } = d.app.info
  if (pid === undefined || !devLane().isStale(startedAt, PACKAGE_ROOT)) return null
  await devLane().stopApp(pid)
  return DEV_RELAUNCH_NOTE
}

const realCannotLaunch = (): string | null => cannotLaunchReason(process.env, process.platform)

const defaultDeps: EnsureDeps = {
  discover: () => discover(),
  launch: () => {
    const target = resolveDefaultTarget()
    if ('error' in target) throw new Error(target.error)
    return launchApp(target, process.env)
  },
  sleep: ms => new Promise(r => setTimeout(r, ms)),
  now: () => Date.now(),
  cannotLaunch: realCannotLaunch,
  ...(devMode() ? { prepare: relaunchStaleDevApp } : {}),
}

/**
 * Gets to the live app or says why not (live-first spec §2). A headless plan
 * passes straight through. Otherwise: use a live app; respect a declined
 * one; launch an absent (or not-asked) one and wait — for it to answer, or
 * for the user to decline in the consent bar — up to `timeoutMs`.
 *
 * Before launching, and only then, consults `cannotLaunch` (default: the
 * real `cannotLaunchReason` against `process.env`/`process.platform`): an
 * app that is already running and reachable is never refused on account of
 * SSH, a missing display, or `OBSRV_TEST=1` (see `cannotLaunchReason`'s own
 * doc comment in src/mcp/lib.ts) — only the moment this function is about to
 * spawn a brand-new one is.
 *
 * `not-asked` (the app is running, control is off, nobody has answered
 * anything) is launched exactly like `absent`: the attempt hits the
 * single-instance lock and knocks, which is what raises the consent bar in
 * the first place (§2c). Past that point the two diverge — see the two
 * comments below.
 */
export async function ensureLive(plan: LivePlan | HeadlessPlan, deps: EnsureDeps = defaultDeps, timeoutMs = LAUNCH_TIMEOUT_MS): Promise<LiveResolution> {
  if (plan.path === 'headless') return plan
  const prepared = deps.prepare ? await deps.prepare() : null
  const notes = prepared === null ? plan.notes : [...plan.notes, prepared]
  const cannotLaunch = deps.cannotLaunch ?? realCannotLaunch
  const first = await deps.discover()
  if (first.kind === 'live') return { path: 'live', app: first.app, launched: false, notes: notes }
  if (first.kind === 'declined') return { path: 'headless', why: 'declined', notes: [...notes, DECLINED_NOTE] }
  const reason = cannotLaunch()
  if (reason !== null) {
    return {
      path: 'headless',
      why: 'no-display',
      notes: [...notes, `the Obsrv app is not running and cannot be launched here (${reason}); rendered headlessly.`],
    }
  }
  // Whether the app that answers `discover()` next was already running
  // before this call (asking it a question) rather than one this call is
  // trying to bring up from nothing (a cold start). Governs both `launched`
  // below (opening a window that was not there is worth telling the agent;
  // an already-open one answering a prompt is not) and which timeout note
  // applies.
  const asking = first.kind === 'not-asked'
  let handle: void | LaunchHandle
  try {
    handle = await deps.launch()
  } catch (e) {
    return {
      path: 'headless',
      why: 'launch-timeout',
      notes: [...notes, `the Obsrv app could not be launched (${e instanceof Error ? e.message : String(e)}); rendered headlessly.`],
    }
  }
  // Finding 2 (final review): a released app with control off predates
  // `writeDisabled` and writes no file at all, so `first.kind` here is
  // `absent`, not `not-asked`. Our own spawned attempt loses the
  // single-instance lock to it and exits almost at once; the old app raises
  // its window but never updates the (nonexistent) file, so `discover()`
  // would report `absent` for the rest of the timeout with nothing left to
  // wait for. Noticing that exit lets this bail promptly instead of burning
  // the whole budget. Scoped to `!asking` on purpose: on the `not-asked`
  // path our attempt exits just as fast, but that exit *is* the successful
  // delivery of the knock (§2c) — the running app answers over `discover()`
  // once a human clicks something, not by keeping our spawned process alive,
  // so its exit must never cut that wait short. A genuinely slow cold start
  // (the app we launched is still booting) never sets this flag, so it still
  // gets the full `timeoutMs` — shortening the bound itself would punish
  // exactly that case.
  let launchExited = false
  if (!asking && handle) void handle.exited.then(() => (launchExited = true))
  const deadline = deps.now() + timeoutMs
  while (deps.now() < deadline) {
    await deps.sleep(LAUNCH_POLL_MS)
    const d = await deps.discover()
    if (d.kind === 'live') return { path: 'live', app: d.app, launched: !asking, notes: notes }
    if (d.kind === 'declined') return { path: 'headless', why: 'declined', notes: [...notes, DECLINED_NOTE] }
    if (launchExited) {
      return {
        path: 'headless',
        why: 'launch-timeout',
        notes: [
          ...notes,
          "the launch exited immediately without a new instance starting — Obsrv's profile is already in use by a process that is not answering the agent-control protocol (an older Obsrv version, or one still finishing its own startup); rendered headlessly.",
        ],
      }
    }
  }
  const timeoutNote = asking
    ? `Obsrv is running and was asked whether to allow agent control, but nobody answered within ${timeoutMs / 1000} s; rendered headlessly. Answering the prompt in Obsrv lets the next call reach it.`
    : `the Obsrv app was launched but did not answer within ${timeoutMs / 1000} s; rendered headlessly. It may still be starting — the next call will find it.`
  return { path: 'headless', why: 'launch-timeout', notes: [...notes, timeoutNote] }
}
