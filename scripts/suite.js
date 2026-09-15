#!/usr/bin/env node
// Runs one test suite while holding the worktree's suite lock.
//
//   node scripts/suite.js <name> <command> [args...]
//
// The lock is one per worktree and covers all three suites, because the
// interference is between them rather than within one: `test:e2e` runs
// `npm run build`, which rewrites `out/` — the same `out/` the CLI specs
// execute and the unit suite's launcher tests read.
//
// A live holder is refused; a lock left by a suite that died is taken over and
// said so. See scripts/suiteLock.js for why those two must never read alike.
'use strict'

const { spawn } = require('node:child_process')
const { join } = require('node:path')
const { LOCK_NAME, acquire, release, refusal, takeoverNotice } = require('./suiteLock.js')

const [suite, command, ...args] = process.argv.slice(2)
if (!suite || !command) {
  console.error('usage: node scripts/suite.js <name> <command> [args...]')
  process.exit(2)
}

const lockDir = join(__dirname, '..', LOCK_NAME)

// OBSRV_SUITE_NO_LOCK exists for the nested case and nothing else: a suite
// that shells out to another `npm run test:*` would otherwise refuse itself.
if (process.env.OBSRV_SUITE_NO_LOCK === '1') {
  run(null)
} else {
  const got = acquire(lockDir, { suite })
  if (!got.ok) {
    console.error(refusal(got.reason))
    process.exit(1)
  }
  // A takeover is not a refusal, so it goes to stderr and the run continues.
  // The age comes from the lock rather than from here: this process has no
  // idea when the dead holder died, and inventing one is how the first run of
  // this guard announced "it died 0s ago" about a suite killed ten seconds
  // earlier.
  if (got.tookOver !== null) console.error(takeoverNotice(got.tookOver))
  run(lockDir)
}

function run(heldLock) {
  const done = () => {
    if (heldLock !== null) release(heldLock)
  }
  const child = spawn(command, args, {
    stdio: 'inherit',
    env: { ...process.env, OBSRV_SUITE_NO_LOCK: '1' },
  })
  child.on('error', err => {
    console.error(`obsrv: failed to run ${command}: ${err.message}`)
    done()
    process.exit(1)
  })
  child.on('exit', (code, signal) => {
    done()
    process.exit(signal ? 1 : (code ?? 1))
  })
  // A signal we forward is the child's to handle; our own exit follows its
  // exit above, which is where the lock is released. A SIGKILL to this process
  // releases nothing — that is precisely the stale case the lock names.
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => child.kill(sig))
  }
}
