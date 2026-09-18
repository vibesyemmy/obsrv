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
// A third mistake, found and corrected during two rounds of dogfooding this
// against real runs rather than assumed either time:
//
//   round 1: `gh run view --log` interleaves EVERY step's output under one
//   job, tab-prefixed by step name — Vitest's own "Test Files 1 failed | 96
//   passed" and "Tests 2 failed | 1393 passed" summaries look like they could
//   collide with Playwright's identically-shaped "<n> failed"/"<n> passed".
//   They don't, in practice: both start with a word and ANSI color codes,
//   never a bare digit, so anchoring each match to the START of the line
//   (see `SUMMARY_RE`/`scanSummary`) already keeps them out on its own —
//   confirmed by re-running the anchored scan, unfiltered by step, over run
//   35285273313's whole job log: still zero hits. Step-scoping is kept as a
//   second layer, not the thing actually doing the work here.
//
//   round 2: step-scoping ALONE is not reliable, and this shipped once
//   before it was caught. `gh run view --log`'s own docs say it can fall
//   back to a slower per-job log fetch and mark lines `UNKNOWN STEP` when
//   platform limits bite. Run 35295017371 — this script's own PR, e2e ran
//   for 22 minutes and passed — came back entirely `UNKNOWN STEP`, and the
//   step-only version of this script reported "e2e step did not run" for a
//   run that plainly had. `e2eSummary` now falls back to scanning the whole
//   job's lines (safe because of the anchor above) whenever ANY line in the
//   run is `UNKNOWN STEP`, rather than trusting attribution that has already
//   proven unreliable for that run.
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
//
// A fifth mistake, caught by @Wren reading a real run rather than trusting
// this script's own logic (room #597): Playwright's own summary line is not
// the whole story even when it prints one. Run 35345417630 printed `1 flaky,
// 617 passed` — `text-scale.spec.ts:251` failed try 1, passed retry #1 — and
// GitHub still marked the e2e step (and the run) `failure`, exit code 1,
// because of a `Worker teardown timeout` that happened after every retried
// test had already passed. The per-test tally has nothing to say about that;
// reading counts alone here would report "failed=0, just a flake" for a run
// that plainly failed. So `formatAttempt` now checks `failed === 0` against
// the run's own `conclusion` and warns on the mismatch rather than only
// printing the counts.
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
 * Scans a set of log lines for the summary counts, anchoring each match to
 * the START of the (trimmed) line — this, not step-scoping, is what actually
 * keeps Vitest's own "Test Files 1 failed | 96 passed" and "Tests 2 failed |
 * 1393 passed" out: both start with a word ("Test Files"/"Tests") and ANSI
 * color codes, never a bare digit, so `^(\d+)\s+...` never matches them.
 * Verified directly against run 35285273313 (Unit tests step failed): this
 * anchored scan over its FULL job log, unfiltered by step, still returns
 * zero hits. Step-scoping below is a second, independent layer of caution on
 * top of the anchor, not the thing load-bearing for that case.
 */
function scanSummary(lines) {
  const counts = { failed: 0, flaky: 0, passed: 0, skipped: 0, interrupted: 0 }
  let sawSummaryLine = false
  for (const content of lines) {
    const m = content.trim().match(SUMMARY_RE)
    if (!m) continue
    sawSummaryLine = true
    counts[m[2]] = Number(m[1])
  }
  return { hasSummary: sawSummaryLine, counts }
}

/**
 * The e2e step's own summary counts for one attempt's log. Prefers lines
 * `gh` attributed to the e2e step by name; when NONE were (the step never
 * ran — board-only, or an earlier step stopped the job first), checks
 * whether attribution simply failed for this run rather than concluding
 * "didn't run": `gh run view --log`'s own docs say it can fall back to a
 * slower per-job fetch and mark lines `UNKNOWN STEP` when platform limits
 * bite, and that was observed for real on run 35295017371 — a run whose e2e
 * step took 22 minutes and passed, entirely mislabeled `UNKNOWN STEP`, read
 * by the step-only version of this function as "did not run". So: any
 * `UNKNOWN STEP` lines present at all means attribution degraded for this
 * run, and the whole job's lines are scanned instead (the anchor above is
 * what keeps that safe) rather than trusting an attribution that just
 * proved unreliable.
 */
function e2eSummary(logLines) {
  const stepLines = logLines.filter(l => l.step === E2E_STEP_NAME).map(l => l.content)
  if (stepLines.length > 0) {
    const { hasSummary, counts } = scanSummary(stepLines)
    return { ran: true, hasSummary, counts, degradedAttribution: false }
  }
  const attributionDegraded = logLines.some(l => l.step === 'UNKNOWN STEP')
  if (attributionDegraded) {
    const { hasSummary, counts } = scanSummary(logLines.map(l => l.content))
    return { ran: hasSummary, hasSummary, counts, degradedAttribution: true }
  }
  return { ran: false, hasSummary: false, counts: {}, degradedAttribution: false }
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
    if (r.degradedAttribution) {
      lines.push("  (gh could not attribute this run's log to step names — read from the whole job's log instead)")
    }
    lines.push(`  failed=${failed} flaky=${flaky} passed=${passed} skipped=${skipped} interrupted=${interrupted}`)
    if (flaky > 0) lines.push(`  ${flaky} test(s) failed their first try and passed on Playwright's retry`)
    if (failed > 0) lines.push(`  ${failed} test(s) failed even after retry — a real red, not absorbed by --retries=1`)
    if (failed === 0 && r.conclusion === 'failure') {
      lines.push(
        "  WARNING: the tally reads clean (failed=0) but the run's own conclusion is `failure` — " +
          "something failed outside what Playwright's own summary counts (seen for real: a Worker teardown " +
          'timeout after every retried test had already passed, exit code 1 regardless). Read the log directly; ' +
          'counts alone would read this as a plain recovered flake and miss that the job actually failed.',
      )
    }
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
