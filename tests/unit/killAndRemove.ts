import type { ChildProcess } from 'node:child_process'
import { rmSync, type RmOptions } from 'node:fs'

/**
 * The teardown for a unit test that starts a process and gives it a temp directory:
 * stop the process, wait for it, and remove the directory with retries.
 *
 * `kill('SIGKILL')` returns before the child is dead, and a directory removed while
 * the child (or something the child started) is still writing into it fails with
 * `ENOTEMPTY`. `boardServeBrowser.test.ts` did exactly that on `#594`'s first suite
 * attempt (run 37461396063), at its `afterEach`, with the assertions all passed.
 *
 * Two things, because waiting for the child is not enough: `scripts/board-serve.js`
 * runs `git` and `tar` as children of its own, so after the server is gone a
 * grandchild can still be writing, and nothing here can wait for a process it does
 * not know about. `rmSync`'s own `maxRetries` (which retries `ENOTEMPTY`, `EBUSY`,
 * `EPERM` and the file-descriptor errors, with a growing delay) covers that, as
 * `tests/e2e/launch.ts` does for the Electron app's helpers.
 */
export const REMOVE_OPTIONS: RmOptions = { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }

/** How long to wait for a killed child to report its exit before going on without it. */
export const EXIT_WAIT_MS = 2_000

export interface TeardownDeps {
  rm?: (path: string, options: RmOptions) => void
  exitWaitMs?: number
}

function stopped(child: ChildProcess, waitMs: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
  return new Promise(resolve => {
    const timer = setTimeout(resolve, waitMs)
    child.once('exit', () => {
      clearTimeout(timer)
      resolve()
    })
    try {
      child.kill('SIGKILL')
    } catch {
      // Already gone.
    }
  })
}

export async function killAndRemove(children: readonly ChildProcess[], dirs: readonly string[], deps: TeardownDeps = {}): Promise<void> {
  const { rm = rmSync, exitWaitMs = EXIT_WAIT_MS } = deps
  await Promise.all(children.map(c => stopped(c, exitWaitMs)))
  for (const d of dirs) rm(d, REMOVE_OPTIONS)
}
