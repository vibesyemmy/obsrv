#!/usr/bin/env node
// Reads a CI run's own e2e summary correctly, replacing the hand grep this
// board card exists to retire (chore-ci-reliability-watch).
//
//   node scripts/ci-flake-check.js <run-id> [--repo owner/repo] [--all-attempts]
//   node scripts/ci-flake-check.js --recent 20 [--repo owner/repo] [--branch main]
//
// Two mistakes this replaces, both seen live in this room before landing here:
//
//   grep -c '✘'                 wrong: absent under the `list` reporter's own
//                                summary lines (only appears per failing test,
//                                and CI does not use `--reporter=line`).
//   grep -c '[0-9]+ flaky'       wrong: `-c` counts matching LINES, so one
//                                summary line reading "3 flaky" reports as 1.
//                                (Henry, room #543.)
//
// A third mistake this script exists specifically to avoid, found while
// building it rather than assumed: `gh run view --log` interleaves EVERY
// step's output under one job, tab-prefixed by step name. Vitest's own
// "Test Files 1 failed | 96 passed" and "Tests 2 failed | 1393 passed"
// summaries match the exact same "<n> failed"/"<n> passed" shape as
// Playwright's, and a plain grep across the whole job log cannot tell them
// apart (verified against run 35285273313: two of five "N failed/passed"
// hits belonged to the Unit tests step, not e2e). So this script filters by
// the e2e step's own name before reading any count, never the raw log.
//
// Per-attempt: a workflow re-run's `conclusion` (and `gh run view`'s default
// output) answers for the LATEST attempt only. A test that fails on attempt 1
// and is manually re-run to green reports success with no visible trace of
// the first failure, which is exactly how a real regression gets read as
// clean (this is the "conclusion is the latest attempt only" trap named in
// the room, distinct from Playwright's own --retries=1). --all-attempts walks
// every recorded attempt so an earlier failure cannot hide behind a later one.
//
// NOT yet observed against a real multi-attempt run in this repo (none was
// in flight while this was built) — the single-attempt path is validated
// against real CI logs; --all-attempts is implemented against `gh`'s
// documented --attempt flag and json `attempt` field, not yet seen firing on
// a genuine re-run. Flagged here rather than claimed as proven.
'use strict'

const { execFileSync } = require('node:child_process')

const E2E_STEP_NAME = 'E2E (Playwright driving the Electron app)'
const SUMMARY_RE = /^(\d+)\s+(failed|flaky|passed|skipped|interrupted)\b/
const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z\s?(.*)$/

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
}

function ghJson(args) {
  return JSON.parse(gh(args))
}

/** Repo-scoped `gh` args, `--repo` first so callers can just spread ...repoArgs, rest. */
function repoArgs(repo) {
  return repo ? ['--repo', repo] : []
}

/**
 * Every `{job, step, content}` line of a run's raw log, content with the
 * leading ISO-8601 timestamp stripped. `gh run view --log` tab-separates
 * job and step ahead of the timestamped line; this is the one place that
 * shape is parsed, so nothing downstream sees the prefix.
 */
function parseLogLines(raw) {
  const out = []
  for (const line of raw.split('\n')) {
    const i1 = line.indexOf('\t')
    const i2 = i1 === -1 ? -1 : line.indexOf('\t', i1 + 1)
    if (i1 === -1 || i2 === -1) continue
    const job = line.slice(0, i1)
    const step = line.slice(i1 + 1, i2)
    const rest = line.slice(i2 + 1)
    const m = rest.match(TIMESTAMP_RE)
    out.push({ job, step, content: m ? m[1] : rest })
  }
  return out
}

/**
 * The e2e step's own summary counts for one attempt's log, read the way
 * Playwright's list reporter actually prints them (one count per category,
 * only when nonzero — a category with no line is 0, not "unknown"). Takes
 * the LAST matching line per category, mirroring `tail -1`: a category can
 * appear more than once if a serial group finishes early and Playwright
 * prints an interim tally before the final one.
 */
function e2eSummary(logLines) {
  const counts = { failed: 0, flaky: 0, passed: 0, skipped: 0, interrupted: 0 }
  let sawAnyLine = false
  let sawSummaryLine = false
  for (const { step, content } of logLines) {
    if (step !== E2E_STEP_NAME) continue
    sawAnyLine = true
    const m = content.trim().match(SUMMARY_RE)
    if (!m) continue
    sawSummaryLine = true
    counts[m[2]] = Number(m[1])
  }
  return { ran: sawAnyLine, hasSummary: sawSummaryLine, counts }
}

/** One attempt's report: fetches its log, scopes to the e2e step, summarizes. */
function checkAttempt(runId, attempt, repo) {
  const viewArgs = ['run', 'view', String(runId), '--attempt', String(attempt), ...repoArgs(repo)]
  const meta = ghJson([...viewArgs, '--json', 'conclusion,status,url'])
  const log = gh([...viewArgs, '--log'])
  const summary = e2eSummary(parseLogLines(log))
  return { attempt, conclusion: meta.conclusion, status: meta.status, url: meta.url, ...summary }
}

function formatAttempt(r) {
  const lines = [`attempt ${r.attempt}: ${r.status}/${r.conclusion || '(pending)'} — ${r.url}`]
  if (!r.ran) {
    lines.push('  e2e step did not run (board-only path, or step name has changed since this script was written)')
  } else if (!r.hasSummary) {
    lines.push(
      '  WARNING: e2e step ran but produced no pass/flaky/failed summary line — ' +
        'a whole-run failure with no per-test signal (crash, hang, worker teardown). ' +
        'Read the step log directly; a per-test tally cannot see this (bug-flakes-gate-the-gate, PR #18).',
    )
  } else {
    const { failed, flaky, passed, skipped, interrupted } = r.counts
    lines.push(`  failed=${failed} flaky=${flaky} passed=${passed} skipped=${skipped} interrupted=${interrupted}`)
    if (flaky > 0) lines.push(`  ${flaky} test(s) failed their first try and passed on Playwright's retry`)
    if (failed > 0) lines.push(`  ${failed} test(s) failed even after retry — a real red, not absorbed by --retries=1`)
  }
  return lines.join('\n')
}

function runOne(runId, { repo, allAttempts }) {
  const head = ghJson(['run', 'view', String(runId), ...repoArgs(repo), '--json', 'attempt,conclusion,url,displayTitle'])
  console.log(`\n=== run ${runId}: ${head.displayTitle} ===`)
  const attempts = allAttempts ? Array.from({ length: head.attempt }, (_, i) => i + 1) : [head.attempt]
  const reports = attempts.map(a => checkAttempt(runId, a, repo))
  for (const r of reports) console.log(formatAttempt(r))
  if (allAttempts && head.attempt > 1) {
    const earlierFailed = reports.slice(0, -1).some(r => r.conclusion === 'failure' || r.counts.failed > 0)
    if (earlierFailed && reports[reports.length - 1].conclusion === 'success') {
      console.log(
        `  NOTE: this run's current (attempt ${head.attempt}) conclusion is success, but an earlier ` +
          `attempt failed — the latest conclusion alone would have hidden that.`,
      )
    }
  }
  return reports
}

function main() {
  const args = process.argv.slice(2)
  const opts = { repo: undefined, branch: 'main', allAttempts: false, recent: undefined, runId: undefined }
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '--repo') opts.repo = args[++i]
    else if (a === '--branch') opts.branch = args[++i]
    else if (a === '--all-attempts') opts.allAttempts = true
    else if (a === '--recent') opts.recent = Number(args[++i])
    else if (!opts.runId) opts.runId = a
    else throw new Error(`unrecognized argument: ${a}`)
  }

  if (opts.recent) {
    const runs = ghJson([
      'run',
      'list',
      '--workflow',
      'ci.yml',
      '--branch',
      opts.branch,
      '-L',
      String(opts.recent),
      ...repoArgs(opts.repo),
      '--json',
      'databaseId',
    ])
    for (const { databaseId } of runs) runOne(databaseId, opts)
    return
  }

  if (!opts.runId) {
    console.error('usage: node scripts/ci-flake-check.js <run-id> [--repo owner/repo] [--all-attempts]')
    console.error('       node scripts/ci-flake-check.js --recent <n> [--repo owner/repo] [--branch main]')
    process.exit(2)
  }
  runOne(opts.runId, opts)
}

main()
