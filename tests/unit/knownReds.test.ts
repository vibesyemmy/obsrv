import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'

/**
 * The known-red list, and the thing that makes it safe to keep.
 *
 * A classified list of pre-existing failures is a decision someone made at a
 * moment, and nothing makes it notice when a test leaves it. Three of the
 * seven rows on the first such list were wrong within hours — and they were
 * the three whose tests had been FIXED, which is to say the rows most likely
 * to be quoted to excuse a red.
 *
 * So a row is keyed by the test's TITLE, which survives an edit that moves it,
 * rather than by `file:line`, which the fix itself invalidates. And a row that
 * no longer names a real test must FAIL, because a list that quietly stops
 * matching excuses reds that no longer exist and hides ones that do — worse
 * than having no list.
 *
 * Same shape as `board:check` and the suite lock: the guard is only worth
 * having if its refusal says which of the two states it found.
 */
const { checkRows, parseList, staleMessage } = createRequire(__filename)('../../scripts/knownReds.js') as {
  parseList: (text: string) => Row[]
  checkRows: (rows: Row[], titles: Set<string>) => Result
  staleMessage: (stale: Row[]) => string
}

interface Row {
  title: string
  why: string
  line: number
}
interface Result {
  matched: Row[]
  stale: Row[]
  ok: boolean
}

const rows = (...titles: string[]): Row[] => titles.map((title, i) => ({ title, why: 'because', line: i + 1 }))

describe('knownReds: a row that no longer names a test', () => {
  it('passes when every row matches a real test title', () => {
    const r = checkRows(rows('a settles', 'b settles'), new Set(['a settles', 'b settles', 'c settles']))
    expect(r.ok).toBe(true)
    expect(r.stale).toEqual([])
    expect(r.matched).toHaveLength(2)
  })

  it('fails when a row names a test that no longer exists', () => {
    // The case that matters: the test was FIXED and renamed or removed, so the
    // row now excuses a red that cannot happen.
    const r = checkRows(rows('a settles', 'the one that was fixed'), new Set(['a settles']))
    expect(r.ok).toBe(false)
    expect(r.stale.map(s => s.title)).toEqual(['the one that was fixed'])
  })

  it('fails on an empty list only if the list claims rows', () => {
    // No rows is a legitimate state — nothing is currently excused — and must
    // not be confused with a list whose rows all went stale.
    expect(checkRows([], new Set(['a settles'])).ok).toBe(true)
  })

  it('the refusal names the row and says a fix is the likely cause', () => {
    const text = staleMessage(rows('the one that was fixed'))
    expect(text).toContain('the one that was fixed')
    expect(text).toMatch(/fixed|renamed|removed/i)
    // It must not read as "the suite is broken" — the list is what is wrong.
    expect(text).toMatch(/known-red|list|row/i)
  })
})

describe('knownReds: the list format', () => {
  it('reads a row per line as `title :: why`, ignoring blanks and comments', () => {
    const parsed = parseList(['# a comment', '', 'a settles :: flaky on CI, see run 34929', 'b settles :: unrelated'].join('\n'))
    expect(parsed).toEqual([
      { title: 'a settles', why: 'flaky on CI, see run 34929', line: 3 },
      { title: 'b settles', why: 'unrelated', line: 4 },
    ])
  })

  it('refuses a row with no reason, because an unexplained excuse is not one', () => {
    expect(() => parseList('a settles')).toThrow(/reason|::/i)
  })
})
