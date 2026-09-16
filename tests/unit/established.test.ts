import { describe, expect, it } from 'vitest'
import { established, EstablishedError } from '../../src/shared/established'

/**
 * The third way to a green that means nothing, and the only one that shows up
 * as a crash rather than a pass: a spec file whose later tests read state its
 * FIRST test fills. Run whole, it works. Run with `-g`, the filler is skipped
 * and the reader dies on `Cannot read properties of undefined (reading
 * 'token')` — which reads like a bug in whatever test you just wrote.
 *
 * Seen for real by Kenya in tests/e2e/live-drive.spec.ts, where `info` (the
 * control port and token) is set inside the file's first test.
 *
 * The fix is not to make the crash prettier. It is to say which of the two
 * happened: the value was never established because this run did not run the
 * test that establishes it, or it was established and is wrong.
 */
describe('established', () => {
  it('returns the value when there is one', () => {
    expect(established({ port: 1 }, 'info', 'the first test')).toEqual({ port: 1 })
    expect(established(0, 'count', 'setup')).toBe(0)
    expect(established('', 'name', 'setup')).toBe('')
    expect(established(false, 'flag', 'setup')).toBe(false)
  })

  it('names the missing value, and what would have established it', () => {
    expect(() => established(undefined, 'info', "the file's first test")).toThrow(EstablishedError)
    try {
      established(undefined, 'info', "the file's first test")
    } catch (e) {
      const text = (e as Error).message
      expect(text).toContain('info')
      expect(text).toContain("the file's first test")
      // The sentence a reader needs, because the alternative reading — "the
      // code under test is broken" — is the one they will reach for.
      expect(text).toMatch(/did not run|was not run|skipped|filtered/i)
    }
  })

  it('names both runs that leave it unset, not only a filtered one', () => {
    // A whole run gets here too: after any failure Playwright replaces the
    // worker and does not re-run the filler, so every later test in the file
    // fails on this. Naming only the filter told CI's reader that ten red
    // tests were "the run, not the code" when they were one real failure.
    try {
      established(undefined, 'info', "the file's first test")
    } catch (e) {
      const text = (e as Error).message
      expect(text).toMatch(/filtered/i)
      expect(text).toMatch(/earlier test in this file failed/i)
      expect(text).toMatch(/first failure/i)
      expect(text).not.toMatch(/the run, not the code/i)
      return
    }
    throw new Error('established(undefined) did not throw')
  })

  it('treats null the same as undefined: neither is an established value', () => {
    expect(() => established(null, 'controlFile', 'beforeAll')).toThrow(EstablishedError)
  })

  it('says nothing about filtering when the value is present, however odd', () => {
    // A guard that fires on a legitimate falsy value teaches people to remove
    // it, which is the same fate as a lock that refuses on a dead holder.
    expect(established(Number.NaN, 'ratio', 'setup')).toBeNaN()
  })
})
