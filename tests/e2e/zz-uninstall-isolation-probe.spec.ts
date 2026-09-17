import { expect, test } from '@playwright/test'
import { _electron as electron } from '@playwright/test'
import { mkdtempSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir, userInfo } from 'node:os'
import { join, resolve } from 'node:path'

/**
 * THROWAWAY — `chore-uninstall-path`, on `probe/uninstall-isolation`. Never merged.
 *
 * `obsrv uninstall` deletes directories, and its tests must therefore create
 * and destroy the real thing's layout somewhere that is *not* a real home. The
 * card's hazard section says why the obvious sandbox does not work on macOS:
 * `os.homedir()` follows `HOME` and `app.getPath()` does not, so a run under a
 * `HOME`-only sandbox writes to the real profile while every Node-side check
 * reports the sandbox clean.
 *
 * `a4` already measured the lever (`CFFIXED_USER_HOME` moves home, userData,
 * appData, logs and cache; `--user-data-dir` misses logs; neither moves temp).
 * **What that run did not establish is what this one is for:** that the lever
 * still holds on *this* tree and on a CI runner, read from inside the running
 * app rather than inferred afterwards — and, the half that makes it isolation
 * rather than redirection, that the machine's own profile gained nothing.
 *
 * Henry's recommendation, and the reason this runs where it does: a runner has
 * a real macOS home and a real Electron, and needs nobody's permission. It does
 * not run on a desk.
 *
 * **This probe deletes nothing.** It launches, reads paths, and counts.
 */
const ON_CI = process.env['CI'] === 'true' || process.env['GITHUB_ACTIONS'] === 'true'

test.describe.configure({ mode: 'serial', timeout: 180_000 })

test('CFFIXED_USER_HOME moves what the uninstaller would remove, and the real profile gains nothing', async () => {
  test.skip(!ON_CI, 'runs on a CI runner only: it launches Electron with a moved home, and a desk is not the place to measure that')

  const real = userInfo().homedir
  const realUserData = `${real}/Library/Application Support/Obsrv`
  const realLogs = `${real}/Library/Logs/Obsrv`
  // Counted before, so "unchanged" is a measurement rather than an assurance.
  // A missing directory counts as -1 so that "absent" and "empty" stay
  // distinguishable: the runner may have neither.
  const count = (p: string): number => (existsSync(p) ? readdirSync(p).length : -1)
  const before = { userData: count(realUserData), logs: count(realLogs) }

  const sandbox = mkdtempSync(join(tmpdir(), 'obsrv-uninstall-sandbox-'))

  const app = await electron.launch({
    args: [resolve(__dirname, '../../out/main/index.js')],
    env: {
      ...process.env,
      OBSRV_TEST: '1',
      // The lever under test. Deliberately NOT paired with --user-data-dir:
      // the question is what this one moves on its own, since that is what an
      // uninstaller's fixture would rely on.
      CFFIXED_USER_HOME: sandbox,
      TMPDIR: join(sandbox, 'tmp'),
    },
  })

  // Read from INSIDE the running app. Inferring the paths from the outside is
  // how a HOME-only sandbox passes: every Node-side check reports the fake
  // path while Chromium writes elsewhere.
  const paths = await app.evaluate(async ({ app: a }) => {
    await a.whenReady()
    return {
      home: a.getPath('home'),
      userData: a.getPath('userData'),
      logs: a.getPath('logs'),
      // a4's table also listed `cache`; Electron's own types for this version
      // do not offer it as a name, so `sessionData` stands in as the other
      // Chromium-state path an uninstaller would care about.
      sessionData: a.getPath('sessionData'),
      temp: a.getPath('temp'),
    }
  })
  await app.close()

  const after = { userData: count(realUserData), logs: count(realLogs) }

  console.log(`  SANDBOX    ${sandbox}`)
  console.log(`  APP PATHS  ${JSON.stringify(paths, null, 0)}`)
  console.log(`  REAL HOME  ${real}`)
  console.log(`  REAL PROFILE  userData ${before.userData} -> ${after.userData}   logs ${before.logs} -> ${after.logs}`)
  console.log(`  SANDBOX HOLDS  ${existsSync(sandbox) ? readdirSync(sandbox).join(', ') : '(gone)'}`)

  // Half one: the paths an uninstaller would remove now resolve in the sandbox.
  for (const key of ['home', 'userData', 'logs', 'sessionData'] as const) {
    expect(paths[key].startsWith(sandbox), `${key} resolved to ${paths[key]}, outside the sandbox`).toBe(true)
  }

  // Half two, and without it the first half is redirection rather than
  // isolation: the machine's own profile is untouched.
  expect(after.userData, 'the real userData gained or lost entries during the sandboxed run').toBe(before.userData)
  expect(after.logs, 'the real logs directory changed during the sandboxed run').toBe(before.logs)

  // And the one a4 recorded that this must not quietly contradict: temp is NOT
  // moved by the lever. Recorded rather than asserted as a requirement — if it
  // ever starts being moved, the log line above says so.
  console.log(`  TEMP (a4: not moved by the lever)  ${paths.temp}  inSandbox=${paths.temp.startsWith(sandbox)}`)
})
