#!/usr/bin/env node
// `obsrv uninstall` — say what Obsrv has written on this machine, what is
// still there, and what a person can run to remove it. Plain Node: no
// Electron, no build of the app needed, and nothing rendered.
//
// IT REMOVES NOTHING. The listing is the half that can be reviewed without
// anyone's data at risk; removal is a separate decision and a separate change
// (board/chore-uninstall-path.md). A reader should not have to infer that from
// the absence of a flag, so the output says it in words.
//
// Everything it knows comes from three pure modules, and the only things it
// does itself are read-only: `existsSync`, `lstatSync` and `readdirSync`.
//   - out/shared/uninstallPlan.js  — what Obsrv's data locations are, measured
//   - out/shared/removalGuard.js   — the check that stands between a path and $HOME
//   - out/shared/uninstallReport.js — this machine's answer, as data and words
'use strict'

const { existsSync, lstatSync, readdirSync } = require('node:fs')
const { join } = require('node:path')

/** Stop counting a directory past this many entries: a size is a hint, not a census. */
const MAX_ENTRIES = 20000

function usage() {
  return `obsrv uninstall — list what Obsrv has written on this machine

Usage:
  obsrv uninstall [flags]

Flags:
  --include-skill  Count the Claude skill (~/.claude/skills/obsrv-screens) as Obsrv's.
  --json           Write the report as JSON instead of text.
  --help           Show this message.

Lists only. It removes nothing, and prints the commands you can run yourself.`
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
  const unknown = argv.filter(a => !['--include-skill', '--json'].includes(a))
  if (unknown.length > 0) {
    process.stderr.write(`obsrv uninstall: unknown ${unknown.length === 1 ? 'flag' : 'flags'} ${unknown.join(', ')}\n\n${usage()}\n`)
    return 2
  }

  let plan, guard, report
  try {
    plan = require('../out/shared/uninstallPlan.js')
    guard = require('../out/shared/removalGuard.js')
    report = require('../out/shared/uninstallReport.js')
  } catch {
    process.stderr.write('obsrv uninstall: this tree is not built — run `npm run build` first.\n')
    return 1
  }

  // The passwd home, not `$HOME`: on macOS `os.homedir()` follows the
  // environment and `app.getPath()` does not, which is the trap the guard
  // exists for. A listing that read the moved home would describe a directory
  // the app never wrote to.
  const home = guard.realHomeDir()
  const built = plan.uninstallPlan({ home, platform: process.platform, includeSkill: argv.includes('--include-skill') })
  const answer = report.uninstallReport({
    plan: built,
    look: path => (existsSync(path) ? { exists: true, ...sizeOf(path) } : { exists: false }),
    check: path => guard.checkRemoval(path),
  })

  if (argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify({ home, platform: process.platform, ...answer }, null, 2)}\n`)
    return 0
  }
  process.stdout.write(`${report.uninstallLines(answer).join('\n')}\n`)
  return 0
}

process.exitCode = main(process.argv.slice(2))
