/**
 * A flow's held session is a single, exclusive resource: while one is
 * running, a concurrent caller must be refused loudly rather than queued or
 * interleaved — a queued caller's action would land at an unpredictable step
 * boundary inside someone else's flow, which is silent corruption with extra
 * steps (`feat-flow-runner`'s own acceptance). This is that lock.
 *
 * File-based, beside `control.json`'s own discovery directory, so any
 * process talking to the same app's control server sees the same lock
 * regardless of which MCP server process it runs under — the same reason
 * `control.json` itself lives where it does rather than in any one
 * process's memory.
 */

import { readFile, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { controlFilePath } from './control'

export interface FlowLockHolder {
  pid: number
  startedAt: string
}

export type AcquireFlowLockResult = { ok: true } | { ok: false; heldBy: FlowLockHolder }

export interface FlowLockDeps {
  /** The lock file's raw contents; null when absent. */
  read: () => Promise<string | null>
  /** Atomically creates the lock file with `contents` — must reject if the
   *  file already exists (the race this whole lock exists to close). */
  createExclusive: (contents: string) => Promise<void>
  /** Removes the lock file; must not throw when it is already gone. */
  remove: () => Promise<void>
  /** Whether `pid` names a process that is still alive. */
  isAlive: (pid: number) => boolean
  now: () => number
}

function parseFlowLock(raw: string): FlowLockHolder | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const { pid, startedAt } = parsed as Record<string, unknown>
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid < 1) return null
  if (typeof startedAt !== 'string' || Number.isNaN(Date.parse(startedAt))) return null
  return { pid, startedAt }
}

/** Takes the lock, or reports who already holds it. A lock whose file
 *  cannot be parsed, or whose pid is not alive, is a crashed run's leftover
 *  rather than a live flow — cleared before trying to take it, exactly as
 *  `discover()` treats a dead-pid `control.json` stance as `absent`. */
export async function acquireFlowLock(deps: FlowLockDeps): Promise<AcquireFlowLockResult> {
  const raw = await deps.read()
  if (raw !== null) {
    const holder = parseFlowLock(raw)
    if (holder !== null && deps.isAlive(holder.pid)) {
      return { ok: false, heldBy: holder }
    }
    await deps.remove()
  }
  const mine: FlowLockHolder = { pid: process.pid, startedAt: new Date(deps.now()).toISOString() }
  try {
    await deps.createExclusive(JSON.stringify(mine))
    return { ok: true }
  } catch {
    // Someone else won the race between our read and our create. Report
    // them rather than silently proceeding as if we had won.
    const raw2 = await deps.read()
    const holder2 = raw2 !== null ? parseFlowLock(raw2) : null
    if (holder2 !== null) return { ok: false, heldBy: holder2 }
    throw new Error('a flow lock exists but could not be read after a create raced against it')
  }
}

export async function releaseFlowLock(deps: Pick<FlowLockDeps, 'remove'>): Promise<void> {
  await deps.remove()
}

/** Beside `control.json`, not inside it: a flow lock is a different fact
 *  (a session is held) from the app's own discovery stance, and the two
 *  must be readable and clearable independently of each other. */
export function flowLockPath(): string {
  return join(dirname(controlFilePath()), 'flow-lock.json')
}

/** `isAlive` mirrors `discover()`'s own dead-pid check in control.ts: ESRCH
 *  means truly gone; anything else (including EPERM, a pid that exists but
 *  belongs to someone else) means still alive. */
export function defaultFlowLockDeps(): FlowLockDeps {
  const path = flowLockPath()
  return {
    read: async () => {
      try {
        return await readFile(path, 'utf8')
      } catch {
        return null
      }
    },
    createExclusive: async contents => {
      await writeFile(path, contents, { flag: 'wx' })
    },
    remove: async () => {
      try {
        await unlink(path)
      } catch {
        // Already gone — releasing (or clearing a stale lock) is idempotent.
      }
    },
    isAlive: pid => {
      try {
        process.kill(pid, 0)
        return true
      } catch (e) {
        return (e as NodeJS.ErrnoException).code !== 'ESRCH'
      }
    },
    now: () => Date.now(),
  }
}
