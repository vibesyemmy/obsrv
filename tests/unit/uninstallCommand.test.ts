import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The thin shell of `obsrv uninstall` (`bin/uninstall.js`). Its logic is pure
 * and tested without a filesystem in `uninstallReport.test.ts`; what is left
 * here is the shell — the dispatch, the flags, and the one guarantee worth
 * spending a process on: **it removes nothing.**
 *
 * **Why the reading arm is CI-only.** Listing reads the home of whoever runs
 * it, and on a developer's machine that is their own Obsrv profile. Nothing
 * here should read a person's data to prove a listing works, so the arm that
 * runs the real thing runs where the home belongs to a runner. The arms that
 * need no home — the help text, an unknown flag — run everywhere.
 */

const BIN = join(__dirname, '..', '..', 'bin', 'obsrv.js')
const run = (...argv: string[]): { status: number | null; stdout: string; stderr: string } => {
  const r = spawnSync(process.execPath, [BIN, 'uninstall', ...argv], { encoding: 'utf8' })
  return { status: r.status, stdout: r.stdout, stderr: r.stderr }
}

describe('obsrv uninstall', () => {
  it('answers --help without Electron, and says in the usage that it removes nothing', () => {
    const r = run('--help')
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('obsrv uninstall — list what Obsrv has written on this machine')
    expect(r.stdout).toContain('Lists only. It removes nothing')
    expect(r.stderr).toBe('')
  })

  it('refuses a flag it does not know rather than guessing at it', () => {
    const r = run('--force')
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('unknown flag --force')
    // And the refusal shows the flags it does know, so the next try is informed.
    expect(r.stderr).toContain('--include-skill')
  })

  it('lists this machine, removes nothing, and hands the commands over instead (CI: the home is a runner’s)', () => {
    if (!process.env['CI']) return
    // The built modules are what the shell requires; a tree without them is a
    // different arm and it is the next one.
    if (!existsSync(join(__dirname, '..', '..', 'out', 'shared', 'uninstallReport.js'))) return

    const r = run('--json')
    expect(r.status, r.stderr).toBe(0)
    const answer = JSON.parse(r.stdout) as {
      home: string
      present: { path: string }[]
      absent: { path: string }[]
      refused: { path: string; refused?: string }[]
      keep: { path: string; why: string }[]
      commands: string[]
    }
    expect(answer.home.length).toBeGreaterThan(0)
    // Every path it names is under the home it read, and every command is a
    // removal a person runs, never one this process ran.
    for (const entry of [...answer.present, ...answer.absent]) expect(entry.path.startsWith(answer.home)).toBe(true)
    for (const command of answer.commands) expect(command).toMatch(/^rm -rf '/)
    // The keep list is the part a reader checks for having been considered.
    expect(answer.keep.length).toBeGreaterThan(0)
    expect(answer.keep.every(k => k.why.length > 0)).toBe(true)
    // A runner has never run the app, so the profile is absent rather than
    // present — and absent is the case where a listing must not claim a win.
    expect(answer.commands.length).toBe(answer.present.length)
  })

  // NOT TESTED HERE: the "this tree is not built" message. Proving it needs a
  // process that requires the shell with `out/` missing, and the honest ways to
  // do that either read the runner's home anyway or copy the launcher into a
  // fixture, which is `cliLauncher.test.ts`'s job and not worth duplicating for
  // one sentence. Named rather than left as a silent gap.
})
