import { readFile, stat } from 'node:fs/promises'
import { request } from 'node:http'
import { homedir } from 'node:os'
import {
  controlFileModeOk,
  defaultControlFilePath,
  parseControlFile,
  parseControlStatus,
  type ControlInfo,
  type ControlStatus,
} from '../shared/control'

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

/**
 * Finds a running, control-enabled Obsrv app: discovery file present, sanely
 * permissioned (no group/other access on POSIX — the app writes it 0600) and
 * well-formed, and a tokened `status` answered within `timeoutMs`. Null on
 * any failure — every path where the app cannot be *proven* live is "not
 * reachable", so auto mode falls back to headless instead of erroring.
 */
export async function discoverControl(timeoutMs = 500): Promise<LiveApp | null> {
  const file = controlFilePath()
  let raw: string
  try {
    const s = await stat(file)
    if (!controlFileModeOk(s.mode, process.platform)) return null
    raw = await readFile(file, 'utf8')
  } catch {
    return null
  }
  const info = parseControlFile(raw)
  if (!info) return null
  // A stamped file whose writer is gone is a crashed run's leftover, not an
  // app: say so without knocking on a port nobody listens to. EPERM means
  // the process exists but belongs to someone else, which is still alive.
  if (info.pid !== undefined) {
    try {
      process.kill(info.pid, 0)
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ESRCH') return null
    }
  }
  try {
    const status = parseControlStatus(await controlCall(info, 'status', {}, timeoutMs))
    return status ? { info, status } : null
  } catch {
    return null
  }
}
