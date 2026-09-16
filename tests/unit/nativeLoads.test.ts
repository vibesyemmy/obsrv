import { describe, expect, it } from 'vitest'
import { loadIssuedAt, loadsAfter } from '../e2e/helpers/nativeLoads'

/**
 * The selection `sync.spec:138` uses to find its own navigation in the native
 * pane's load trace. Unit-tested because the case that matters cannot be
 * staged reliably from outside — a mirror into the native pane landing after
 * the spec's own load is a race — and because reading the wrong record
 * produces the OPPOSITE answer to the question the trace exists for.
 */

const REDIRECT = 'file:///fixtures/redirect.html'
const HAIRLINE = 'file:///fixtures/hairline.html'
const rec = (at: number, url: string, outcome: string) => ({ at, url, outcome, tookMs: 1 })

describe('finding the load a spec issued', () => {
  it('picks the spec’s own load even when a mirror into the pane follows it', () => {
    // bug-sync138's hypothesis (a): step 2 aborted by a later navigation. The
    // aborted record is second from last, and `at(-1)` would report the
    // mirror's `ok` — so the reader would conclude (b), the opposite fact.
    const trace = [
      rec(100, HAIRLINE, 'ok'),
      rec(200, REDIRECT, 'aborted'),
      rec(205, HAIRLINE, 'ok'),
    ]
    expect(loadIssuedAt(trace, REDIRECT, 200)).toMatchObject({ at: 200, outcome: 'aborted' })
  })

  it('ignores an earlier load of the same url, from the step before', () => {
    // Step 1 navigates to REDIRECT too, so the url alone is not enough.
    const trace = [rec(100, REDIRECT, 'ok'), rec(300, REDIRECT, 'aborted')]
    expect(loadIssuedAt(trace, REDIRECT, 250)).toMatchObject({ at: 300 })
  })

  it('finds nothing when the pane never loaded that url, rather than guessing', () => {
    expect(loadIssuedAt([rec(100, HAIRLINE, 'ok')], REDIRECT, 50)).toBeUndefined()
  })

  it('counts the other loads that followed, since a mirror during step 2 is itself evidence', () => {
    const picked = rec(200, REDIRECT, 'aborted')
    const trace = [rec(100, HAIRLINE, 'ok'), picked, rec(205, HAIRLINE, 'ok'), rec(210, HAIRLINE, 'ok')]
    expect(loadsAfter(trace, picked)).toBe(2)
    expect(loadsAfter([picked], picked)).toBe(0)
  })
})
