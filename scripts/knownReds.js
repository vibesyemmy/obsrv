#!/usr/bin/env node
// The known-red list, and the check that stops it rotting.
//
//   node scripts/knownReds.js --check
//
// A classified list of pre-existing failures lets a reviewer clear a red in
// ten seconds instead of waiting 17 minutes for a macOS suite. That is worth
// having. What makes it dangerous is that it is a decision taken at a moment,
// and nothing makes it notice when a test leaves it.
//
// Measured rather than feared: three of the seven rows on the first such list
// were wrong within hours of its being written, and they were the three whose
// tests had been FIXED — the rows most likely to be quoted to excuse a red.
// They pointed at `live-drive.spec.ts:963`, `:1015` and `sync.spec.ts:165`,
// which by then were an expectation, a `while` and a comment.
//
// So: a row is keyed by the test's TITLE. A title survives the edit that moves
// a test; a line number is invalidated by the fix that makes the row obsolete.
// And a row matching no test FAILS this check, because a list that quietly
// stops matching excuses reds that no longer exist and hides ones that do,
// which is worse than having no list at all.
'use strict'

const { readFileSync, readdirSync } = require('node:fs')
const { join } = require('node:path')

/** Where the list lives. One row per line: `test title :: why it is excused`. */
const LIST = join(__dirname, '..', 'docs', 'known-reds.txt')
const SPEC_DIR = join(__dirname, '..', 'tests', 'e2e')

/**
 * Reads the list. A row with no reason is refused rather than accepted: an
 * excuse nobody explained is the kind that outlives its cause.
 *
 * @param {string} text
 */
function parseList(text) {
  const rows = []
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim()
    if (raw === '' || raw.startsWith('#')) continue
    const at = raw.indexOf('::')
    if (at === -1) throw new Error(`known-reds line ${i + 1} has no reason: a row is \`test title :: why\`, and an excuse nobody explained outlives its cause`)
    const title = raw.slice(0, at).trim()
    const why = raw.slice(at + 2).trim()
    if (title === '' || why === '') throw new Error(`known-reds line ${i + 1} has no reason: a row is \`test title :: why\``)
    rows.push({ title, why, line: i + 1 })
  }
  return rows
}

/** Every `test('...')` / `it('...')` title in the e2e specs. */
function specTitles(dir = SPEC_DIR) {
  const titles = new Set()
  const walk = d => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, entry.name)
      if (entry.isDirectory()) walk(p)
      else if (entry.name.endsWith('.spec.ts')) {
        const src = readFileSync(p, 'utf8')
        // Both quote styles, and `test.skip`/`test.only` too — a skipped test
        // is still a test the list may legitimately name.
        for (const m of src.matchAll(/\b(?:test|it)(?:\.\w+)*\(\s*(['"])((?:\\.|(?!\1).)*)\1/g)) {
          titles.add(m[2].replace(/\\(['"])/g, '$1'))
        }
      }
    }
  }
  walk(dir)
  return titles
}

/**
 * @param {{title: string, why: string, line: number}[]} rows
 * @param {Set<string>} titles
 */
function checkRows(rows, titles) {
  const matched = rows.filter(r => titles.has(r.title))
  const stale = rows.filter(r => !titles.has(r.title))
  return { matched, stale, ok: stale.length === 0 }
}

/** The refusal, which must blame the list rather than the suite. */
function staleMessage(stale) {
  const lines = stale.map(r => `  line ${r.line}: "${r.title}"\n    excused because: ${r.why}`)
  return [
    stale.length === 1
      ? '1 known-red row no longer names a test in tests/e2e:'
      : `${stale.length} known-red rows no longer name a test in tests/e2e:`,
    ...lines,
    '',
    'A row goes stale when its test is fixed, renamed or removed — and a fixed',
    'test is the commonest cause, which makes these the rows most likely to be',
    'quoted to excuse a red that can no longer happen. Delete the row, or correct',
    'the title. This is the list being wrong, not the suite.',
  ].join('\n')
}

module.exports = { LIST, parseList, specTitles, checkRows, staleMessage }

if (require.main === module) {
  let text = ''
  try {
    text = readFileSync(LIST, 'utf8')
  } catch {
    console.log('known-reds: no list at docs/known-reds.txt — nothing is currently excused')
    process.exit(0)
  }
  const rows = parseList(text)
  const result = checkRows(rows, specTitles())
  if (!result.ok) {
    console.error(staleMessage(result.stale))
    process.exit(1)
  }
  console.log(
    rows.length === 0
      ? 'known-reds: the list is empty — nothing is currently excused'
      : `known-reds: ${rows.length} row${rows.length === 1 ? '' : 's'}, ${rows.length === 1 ? 'naming a test' : 'each naming a test'} that exists`,
  )
}
