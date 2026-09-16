#!/usr/bin/env node
// Fails a green e2e run that skipped a test nobody listed (bug-ci-skips-are-unlisted).
//
//   node scripts/check-e2e-skips.js <playwright-json-report> <expected-skips.json>
//
// A skip is silent. It prints a dash in the list output, the suite stays green,
// and the summary's skipped count is easy to read past. #141 made the
// focusWindow test skip on every CI run, blaming the runner, and only a person
// reading the log noticed. So every test a CI run skips must be listed, with
// its reason, in tests/e2e/expected-skips.json. A skip that isn't listed fails,
// and so does a listed test that ran: a stale row is a reason nobody checks
// any more.
'use strict'

const { readFileSync } = require('node:fs')
const { basename } = require('node:path')

/**
 * Every test the report marks skipped, and every test that skipped on a retry,
 * as { file, title, line, why, retry }. `title` joins the describe titles and
 * the test's own with " › ", which is what the list reporter prints, so a row
 * can be copied from a CI log. The file is the spec's basename, because lines
 * move and files rarely do.
 *
 * `retry` marks a test Playwright reports as flaky whose later attempt skipped.
 * A first attempt that failed and a retry that skipped counts as flaky, not
 * skipped, and the run stays green, so the skip is as silent as any other
 * (Wren's read). A guard that evaluates differently in a fresh worker can do
 * exactly that.
 *
 * The reason is read from the test's annotations and from each result's: a
 * runtime `test.skip(condition, reason)` may land on the result only.
 */
function skippedTests(report) {
  const out = []
  const reasonOf = t =>
    [...(t.annotations ?? []), ...(t.results ?? []).flatMap(r => r.annotations ?? [])]
      .filter(a => a.type === 'skip' && a.description)
      .map(a => a.description)
      .filter((d, i, all) => all.indexOf(d) === i)
      .join('; ')
  const walk = (suite, titles) => {
    const file = suite.file ? basename(suite.file) : undefined
    // A file's own suite is titled with the file name, which the key already carries.
    const own = suite.title && suite.title !== file ? [...titles, suite.title] : titles
    for (const spec of suite.specs ?? []) {
      for (const t of spec.tests ?? []) {
        const skipped = t.status === 'skipped'
        const retry = !skipped && (t.results ?? []).some(r => r.status === 'skipped')
        if (!skipped && !retry) continue
        out.push({ file: basename(spec.file ?? suite.file ?? ''), title: [...own, spec.title].join(' › '), line: spec.line, why: reasonOf(t), retry })
      }
    }
    for (const child of suite.suites ?? []) walk(child, own)
  }
  for (const suite of report.suites ?? []) walk(suite, [])
  return out
}

/** How many tests the report accounts for at all: zero means there is nothing to judge. */
function testCount(report) {
  const s = report.stats ?? {}
  return (s.expected ?? 0) + (s.unexpected ?? 0) + (s.flaky ?? 0) + (s.skipped ?? 0)
}

/** The skips nobody listed, and the listed rows that did not skip. */
function compareSkips(skipped, listed) {
  const key = r => `${r.file} › ${r.title}`
  const listedKeys = new Set(listed.map(key))
  const skippedKeys = new Set(skipped.map(key))
  return {
    unlisted: skipped.filter(s => !listedKeys.has(key(s))),
    stale: listed.filter(l => !skippedKeys.has(key(l))),
  }
}

function main(reportPath, listPath) {
  let report
  try {
    report = JSON.parse(readFileSync(reportPath, 'utf8'))
  } catch (e) {
    throw new Error(`cannot read the e2e report at ${reportPath} (${e instanceof Error ? e.message : String(e)}), so no skip was checked`)
  }
  if (testCount(report) === 0) {
    throw new Error(`the e2e report at ${reportPath} accounts for no tests at all, so there is nothing to check skips against`)
  }
  const list = JSON.parse(readFileSync(listPath, 'utf8'))
  const listed = Array.isArray(list.skips) ? list.skips : []
  for (const row of listed) {
    if (!row.file || !row.title || !row.why) throw new Error(`${listPath}: every row needs file, title and why; got ${JSON.stringify(row)}`)
  }
  const skipped = skippedTests(report)
  // The walk and the report's own count must agree. If the report's nesting
  // ever changes, the walk finds nothing while stats still counts the skips,
  // and this check would print "0 skipped, all listed" over a run that skipped
  // tests: the silence it exists to stop (Wren's read).
  const walkedSkips = skipped.filter(s => !s.retry).length
  const statsSkips = report.stats?.skipped ?? 0
  if (walkedSkips !== statsSkips) {
    throw new Error(
      `the e2e report counts ${statsSkips} skipped test(s) but walking its suites found ${walkedSkips}, ` +
        'so the report shape is not the one this check reads, and no skip was checked',
    )
  }
  const { unlisted, stale } = compareSkips(skipped, listed)
  const lines = []
  for (const s of unlisted) {
    const what = s.retry ? 'skipped on a retry and not listed' : 'skipped and not listed'
    lines.push(`${what}: ${s.file}:${s.line} › ${s.title}${s.why ? ` (its reason: "${s.why}")` : ''}`)
  }
  for (const l of stale) lines.push(`listed but not skipped: ${l.file} › ${l.title} (listed because: "${l.why}")`)
  if (lines.length > 0) {
    throw new Error(
      `${lines.join('\n')}\n` +
        `A skip on a green run is silent, so every one is listed with its reason in ${listPath}. ` +
        'Add a row only once the reason is established; remove a row when the test runs again.',
    )
  }
  return `${testCount(report)} tests; ${skipped.length} skipped, all listed`
}

module.exports = { skippedTests, compareSkips, testCount, main }

if (require.main === module) {
  const [reportPath, listPath] = process.argv.slice(2)
  try {
    console.log(`e2e skips: ${main(reportPath, listPath)}`)
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e))
    process.exit(1)
  }
}
