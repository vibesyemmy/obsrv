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
 * Every test the report marks skipped, as { file, title, line, why }. `title`
 * joins the describe titles and the test's own with " › ", which is what the
 * list reporter prints, so a row can be copied from a CI log. The file is the
 * spec's basename, because lines move and files rarely do.
 */
function skippedTests(report) {
  const out = []
  const walk = (suite, titles) => {
    const file = suite.file ? basename(suite.file) : undefined
    // A file's own suite is titled with the file name, which the key already carries.
    const own = suite.title && suite.title !== file ? [...titles, suite.title] : titles
    for (const spec of suite.specs ?? []) {
      for (const t of spec.tests ?? []) {
        if (t.status !== 'skipped') continue
        const why = (t.annotations ?? []).filter(a => a.type === 'skip').map(a => a.description ?? '').join('; ')
        out.push({ file: basename(spec.file ?? suite.file ?? ''), title: [...own, spec.title].join(' › '), line: spec.line, why })
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
  const { unlisted, stale } = compareSkips(skipped, listed)
  const lines = []
  for (const s of unlisted) {
    lines.push(`skipped and not listed: ${s.file}:${s.line} › ${s.title}${s.why ? ` (its reason: "${s.why}")` : ''}`)
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
