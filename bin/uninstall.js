#!/usr/bin/env node
// `obsrv uninstall` — say what Obsrv has written on this machine, what is
// still there, and what a person can run to remove it. Plain Node: no
// Electron, no build of the app needed, and nothing rendered.
//
// IT REMOVES NOTHING UNLESS ASKED. Without `--remove` this lists, exactly as it
// always did, and says so in its own output. `--remove` deletes what it listed
// — authorised by Opeyemi on 2026-09-17, in the session that wrote it, which is
// the condition board/chore-uninstall-path.md set before any deletion code
// existed.
//
// The listing half stayed reviewable without anyone's data at risk, and the
// removing half is built to keep that property: every decision it makes lives
// in a pure module with the filesystem injected, so the part that can be tested
// without a real file is, and the part that cannot is the single
// `removeListed` call below — the one place `rmSync` is named.
//
//   - out/shared/uninstallPlan.js    — what Obsrv's data locations are, measured
//   - out/shared/removalGuard.js     — the check that stands between a path and $HOME
//   - out/shared/uninstallReport.js  — this machine's answer, as data and words
//   - out/shared/uninstallRemoval.js — which of them to remove, and what happened
//
// The two read-only calls it still makes itself are `lstatSync` and
// `readdirSync` (sizes); the one destructive call is `rmSync`, and it is passed
// IN to the decision module rather than reached for inside it.
'use strict'

const { existsSync, lstatSync, readdirSync, rmSync } = require('node:fs')
const { join } = require('node:path')

/** Stop counting a directory past this many entries: a size is a hint, not a census. */
const MAX_ENTRIES = 20000

function usage() {
  return `obsrv uninstall — list what Obsrv has written on this machine

Usage:
  obsrv uninstall [flags]

Flags:
  --remove         Actually remove what is listed. Without it, this lists only.
  --include-skill  Count the Claude skill (~/.claude/skills/obsrv-screens) as Obsrv's.
  --json           Write the report as JSON instead of text.
  --help           Show this message.

Lists by default, and removes nothing. \`--remove\` deletes the paths it lists,
each one re-checked against the removal guard at the moment it goes.\``
}

/**
 * Bytes under a path, bounded. Read-only: lstat and readdir, never a write.
 *
 * `lstatSync`, not `statSync`: a symlink inside the profile would otherwise
 * count its target, and a size that includes files outside the directory
 * overstates what is there. It matters more for the removal half than for this
 * one — `rm -rf` does not follow a link either, so a followed size promises
 * space that removing the directory never frees (Wren's read of #298).
 */
function sizeOf(path) {
  let bytes = 0
  let seen = 0
  let partial = false
  const stack = [path]
  while (stack.length > 0) {
    if (seen >= MAX_ENTRIES) {
      partial = true
      break
    }
    const next = stack.pop()
    let stats
    try {
      stats = lstatSync(next)
    } catch {
      continue
    }
    seen++
    if (stats.isSymbolicLink()) {
      // The link itself is a few bytes and removal takes it; whatever it
      // points at is somebody else's to count.
      bytes += stats.size
    } else if (stats.isDirectory()) {
      let entries = []
      try {
        entries = readdirSync(next)
      } catch {
        continue
      }
      for (const entry of entries) stack.push(join(next, entry))
    } else bytes += stats.size
  }
  return { bytes, partial }
}

function main(argv) {
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(`${usage()}\n`)
    return 0
  }
  const unknown = argv.filter(a => !['--include-skill', '--json', '--remove'].includes(a))
  if (unknown.length > 0) {
    process.stderr.write(`obsrv uninstall: unknown ${unknown.length === 1 ? 'flag' : 'flags'} ${unknown.join(', ')}\n\n${usage()}\n`)
    return 2
  }

  let plan, guard, report, removal
  try {
    plan = require('../out/shared/uninstallPlan.js')
    guard = require('../out/shared/removalGuard.js')
    report = require('../out/shared/uninstallReport.js')
    removal = require('../out/shared/uninstallRemoval.js')
  } catch {
    process.stderr.write('obsrv uninstall: this tree is not built — run `npm run build` first.\n')
    return 1
  }

  // The passwd home, not `$HOME`: on macOS `os.homedir()` follows the
  // environment and `app.getPath()` does not, which is the trap the guard
  // exists for. A listing that read the moved home would describe a directory
  // the app never wrote to.
  //
  // `OBSRV_TEST_HOME`/`OBSRV_TEST_SANDBOX_ROOT`, gated behind `OBSRV_TEST=1`
  // like every other test-only knob in this codebase: an end-to-end test
  // needs a real, disposable home to remove against, and a home substituted
  // by itself would not be enough — `checkRemoval`'s own `sandboxRoot` is
  // what makes a caller's mistake refuse loudly instead of reaching the real
  // one, and this is that option's only caller. Unset (the normal case),
  // both are `undefined` and behaviour is exactly what it was.
  const underTest = process.env.OBSRV_TEST === '1'
  const home = (underTest && process.env.OBSRV_TEST_HOME) || guard.realHomeDir()
  const sandboxRoot = underTest ? process.env.OBSRV_TEST_SANDBOX_ROOT : undefined
  const built = plan.uninstallPlan({ home, platform: process.platform, includeSkill: argv.includes('--include-skill') })
  const answer = report.uninstallReport({
    plan: built,
    look: path => (existsSync(path) ? { exists: true, ...sizeOf(path) } : { exists: false }),
    check: path => guard.checkRemoval(path, { sandboxRoot }),
  })

  if (argv.includes('--json') && !argv.includes('--remove')) {
    process.stdout.write(`${JSON.stringify({ home, platform: process.platform, ...answer }, null, 2)}\n`)
    return 0
  }

  // The listing always prints first, including under `--remove`: a person
  // watching a delete should see what it is about to take before it takes it,
  // and the same text is what they would have got without the flag.
  process.stdout.write(`${report.uninstallLines(answer, { removing: argv.includes('--remove') }).join('\n')}\n`)
  if (!argv.includes('--remove')) return 0

  // `rmSync` with `recursive` unlinks a symlink rather than descending into
  // it — measured in `uninstallRemoval.test.ts`, because `checkRemoval`'s own
  // comment says it narrows that hole rather than closing it, and the duty to
  // not follow links is the caller's.
  const done = removal.removeListed({
    report: answer,
    check: path => guard.checkRemoval(path, { sandboxRoot }),
    remove: path => rmSync(path, { recursive: true }),
  })

  if (argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify({ home, platform: process.platform, removed: done }, null, 2)}\n`)
  } else {
    process.stdout.write(`\n${removal.removalLines(done).join('\n')}\n`)
  }
  // Anything still there is an exit code, not just a paragraph: a script that
  // uninstalls and moves on should not move on.
  //
  // `refused` counts as well as `failed` (Idris, reviewing this). Both mean a
  // path you asked to remove is still on the disk, and a refusal is the more
  // alarming of the two: the report allowed it and the guard then said no, so
  // the two disagree and the caller is the one who needs to know.
  return removal.removalExitCode(done)
}

process.exitCode = main(process.argv.slice(2))
