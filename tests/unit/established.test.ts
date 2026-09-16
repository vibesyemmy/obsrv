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

  it('keys on whether an earlier test failed, and does not close the list of other causes', () => {
    // A whole run gets here too: after any failure Playwright replaces the
    // worker and does not re-run the filler, so every later test in the file
    // fails on this. Naming only the filter told CI's reader that ten red
    // tests were "the run, not the code" when they were one real failure; the
    // next version named "two runs" and sent a reader who had re-run one test
    // by file:line looking for an earlier failure that did not exist.
    try {
      established(undefined, 'info', "the file's first test")
    } catch (e) {
      const text = (e as Error).message
      // The fork, on the fact the reader can observe.
      expect(text).toMatch(/If an earlier test in this file failed in this run/)
      expect(text).toMatch(/read that first failure/)
      // The other branch, as an open set that includes the commonest single-test rerun.
      expect(text).toMatch(/If none did/)
      expect(text).toContain('file:line')
      expect(text).not.toMatch(/the run, not the code/i)
      expect(text).not.toMatch(/two runs/i)
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
