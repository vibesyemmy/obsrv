// One test suite at a time, per worktree — and a refusal that says WHICH of
// the two things it found.
//
// Two concurrent suites in one worktree made both greens untrustworthy and cost
// an afternoon: `test:e2e` rebuilds `out/`, which the CLI specs then run, so a
// second suite is reading a tree the first is rewriting.
//
// The hard part is not the mutual exclusion. A lock held by a LIVE suite and a
// lock left behind by one that DIED are identical as files, and a guard that
// refuses on a dead owner gets its lock deleted by hand by the first person it
// blocks — after which nobody trusts it again. So the holder is recorded and
// its liveness is what separates the two: a live holder is refused, a dead
// one's lock is taken over, and both cases say so in words that cannot be
// mistaken for each other.
//
// The pattern is `bin/electronPath.js`'s install lock, which solved the same
// problem for a different resource: atomic `mkdir`, a holder file, and
// `process.kill(pid, 0)` for liveness.
'use strict'

const { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

/** The lock directory's name, taken with an atomic `mkdir` in the worktree root. */
const LOCK_NAME = '.obsrv-suite.lock'

/**
 * A lock with no holder file yet is trusted for this long: its owner is
 * between the `mkdir` and the write. Calling that stale lets a second suite
 * take a lock the first is in the middle of taking.
 */
const LOCK_YOUNG_MS = 5_000

const holderPath = lockDir => join(lockDir, 'holder.json')

/** @returns {{pid: number, suite: string, startedAt: string} | null} */
function readHolder(lockDir) {
  try {
    const raw = JSON.parse(readFileSync(holderPath(lockDir), 'utf8'))
    if (!Number.isInteger(raw.pid) || raw.pid <= 0) return null
    return { pid: raw.pid, suite: String(raw.suite ?? 'unknown'), startedAt: String(raw.startedAt ?? '') }
  } catch {
    return null
  }
}

/** Whether a pid is a running process. EPERM means it exists and is not ours. */
function processAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return Boolean(e && e.code === 'EPERM')
  }
}

/**
 * What is on disk, and which of the two it is.
 *
 * `isAlive` is injected so the tests can plant a pid without a process behind
 * it: whether some pid happens to be running on this machine is exactly the
 * state this code exists to cope with.
 */
function lockState(lockDir, isAlive = processAlive, now = Date.now()) {
  let dirStat
  try {
    dirStat = statSync(lockDir)
  } catch {
    return { state: 'free' }
  }
  const holder = readHolder(lockDir)
  if (holder === null) {
    const ageMs = now - dirStat.mtimeMs
    return ageMs < LOCK_YOUNG_MS ? { state: 'starting', ageMs } : { state: 'stale', pid: 0, suite: 'unknown', ageMs }
  }
  const started = Date.parse(holder.startedAt)
  const ageMs = Number.isNaN(started) ? now - dirStat.mtimeMs : now - started
  return { state: isAlive(holder.pid) ? 'live' : 'stale', pid: holder.pid, suite: holder.suite, ageMs }
}

function writeHolder(lockDir, suite, pid, now) {
  writeFileSync(holderPath(lockDir), `${JSON.stringify({ pid, suite, startedAt: new Date(now).toISOString() })}\n`)
}

/**
 * Takes the lock, or refuses with the state that stopped it.
 *
 * A stale lock is taken over rather than refused, and the caller is told whose
 * it was — a suite that died is not a reason to stop the next one, it is a
 * reason to say what happened.
 */
function acquire(lockDir, { suite, pid = process.pid, isAlive = processAlive, now = Date.now() }) {
  try {
    mkdirSync(lockDir)
    writeHolder(lockDir, suite, pid, now)
    return { ok: true, tookOver: null }
  } catch (e) {
    if (!e || e.code !== 'EEXIST') throw e
  }
  const state = lockState(lockDir, isAlive, now)
  if (state.state === 'free') return acquire(lockDir, { suite, pid, isAlive, now })
  if (state.state !== 'stale') return { ok: false, reason: state }

  // The age travels with the takeover: the caller announces how long the
  // holder had been dead, and a caller with nothing to announce prints a
  // number it invented. The first run of this guard against a suite killed ten
  // seconds earlier said "it died 0s ago".
  const previous = { pid: state.pid, suite: state.suite, ageMs: state.ageMs }
  writeHolder(lockDir, suite, pid, now)
  // Two processes that saw the same dead holder could both write; the last
  // one wins the file and the other would run believing it held the lock.
  // Re-reading settles it without a second mutex — the loser sees a holder
  // that is not itself and is refused, which is the safe direction. The
  // heavier pattern, if a race ever shows up in practice, is the takeover
  // mutex in bin/electronPath.js.
  const held = readHolder(lockDir)
  if (held === null || held.pid !== pid) return { ok: false, reason: lockState(lockDir, isAlive, now) }
  return { ok: true, tookOver: previous }
}

/** Removes the lock, but only if this pid is the recorded holder. */
function release(lockDir, pid = process.pid) {
  const holder = readHolder(lockDir)
  if (holder === null || holder.pid !== pid) return false
  rmSync(lockDir, { recursive: true, force: true })
  return true
}

const duration = ms => {
  const s = Math.round(ms / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}

/**
 * The refusal, and the whole point of this module: the two states must not
 * read the same. "the lock is in use" fits a running suite and a corpse
 * equally, and a reader who cannot tell them apart deletes the lock.
 */
function refusal(state) {
  if (state.state === 'live') {
    return [
      `obsrv: the ${state.suite} suite is already running (pid ${state.pid}, started ${duration(state.ageMs)} ago).`,
      'Two suites in one worktree make both results untrustworthy — test:e2e rewrites out/ while the CLI specs read it.',
      'Wait for it to finish, or stop that process. This is a live holder, not a leftover file: do not delete the lock.',
    ].join('\n')
  }
  if (state.state === 'stale') return takeoverNotice(state)
  return [
    `obsrv: another suite is starting and has not recorded its pid yet (${duration(state.ageMs)} ago).`,
    'Give it a moment and try again — this is a lock being taken, not a leftover file.',
  ].join('\n')
}

/**
 * What a takeover says. Not a refusal — nothing was refused — but it must name
 * the lock as stale in those words, and say how long its holder had been gone,
 * because "the lock was there and now it is mine" fits a corpse and a theft
 * equally.
 */
function takeoverNotice({ pid, suite, ageMs }) {
  const whose = pid > 0 ? `pid ${pid}, which is no longer running` : 'a process that left no pid'
  return [
    `obsrv: taking over a stale lock from the ${suite} suite — ${whose}.`,
    `It died ${duration(ageMs)} ago without releasing. Nothing is running; continuing.`,
  ].join('\n')
}

module.exports = { LOCK_NAME, LOCK_YOUNG_MS, lockState, acquire, release, refusal, takeoverNotice, processAlive }
