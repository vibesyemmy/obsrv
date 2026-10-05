import { describe, expect, it } from 'vitest'
import { isBusCommit, mirrorTerms, type MirrorTerms } from '../../src/shared/mirrorTerms'

/**
 * `mirrorTerms` records which term stamped a commit as the bus's
 * (`bug-redirect-note-missing-not-late`). It must **agree with the decision it describes** and
 * must **never be the decision**: `TargetSource` still computes `fromBus` itself.
 *
 * **The oracle copy is gone.** This test used to hold a verbatim copy of `isMirrorCommit`'s body,
 * because the real one was private to a class that needs Electron to build — and it said so:
 * *"if the real expression changes and this oracle does not, this test goes on passing."* The
 * decision now lives in `isBusCommit` beside the terms, so these call the real expression.
 *
 * That limit was not theoretical: the expression DID change (the fix for this card), and a copy
 * would have gone on agreeing with itself.
 */
const HAIRLINE = 'file:///fixtures/hairline.html'
const REDIRECT = 'file:///fixtures/redirect.html'
const or = (t: MirrorTerms): boolean => isBusCommit(t)

describe('mirrorTerms', () => {
  it('records every term over the whole truth table, and the decision reads only those terms', () => {
    const inFlight: Array<[string, string | undefined]> = [
      ['none in flight', undefined],
      ['mirror asked for this very address', HAIRLINE],
      ['mirror asked for a different address', REDIRECT],
    ]
    let rows = 0
    for (const [label, mirrorRequested] of inFlight) {
      for (const byDocument of [true, false]) {
        for (const startFromBusDocument of [true, false]) {
          const t = mirrorTerms(HAIRLINE, byDocument, mirrorRequested, startFromBusDocument)
          // With no start times given, nothing is known to have started first, so the
          // decision is the plain OR of the three terms — the behaviour before the fix.
          expect(t.answeredOwnStart, `${label}, byDocument=${byDocument}`).toBe(false)
          expect(isBusCommit(t), `${label}, byDocument=${byDocument}, fromBusDocument=${startFromBusDocument}`).toBe(
            t.viaMirrorUrl || t.viaNotByDocument || t.viaBusDocument,
          )
          rows++
        }
      }
    }
    // A table that quietly shrinks would pass vacuously.
    expect(rows).toBe(12)
  })

  it("names the case under investigation: a page's own commit to the address the bus is mirroring is stamped by the URL term alone", () => {
    // The page redirected itself to hairline.html (byDocument), the bus's mirrored load is for
    // hairline.html too, and the navigation did not begin in a bus-placed document. Nothing about
    // this commit's initiator is consulted: the address match is enough.
    const t = mirrorTerms(HAIRLINE, true, HAIRLINE, false)
    expect(t).toEqual({
      mirrorRequested: HAIRLINE,
      byDocument: true,
      viaMirrorUrl: true,
      viaNotByDocument: false,
      viaBusDocument: false,
      answeredOwnStart: false,
    })
    expect(or(t)).toBe(true)
  })

  it("does not stamp a page's own redirect to a DIFFERENT address inside the window (what `isMirrorCommit`'s own comment says)", () => {
    const t = mirrorTerms(HAIRLINE, true, REDIRECT, false)
    expect(t.viaMirrorUrl).toBe(false)
    expect(t.viaNotByDocument).toBe(false)
    expect(or(t)).toBe(false)
  })

  it("stamps a server-side redirect of the bus's own load — no document initiator, a different address — by the second term", () => {
    const t = mirrorTerms(HAIRLINE, false, REDIRECT, false)
    expect(t.viaMirrorUrl).toBe(false)
    expect(t.viaNotByDocument).toBe(true)
  })

  it('with no mirror in flight, only a chain the bus began can stamp a commit', () => {
    expect(or(mirrorTerms(HAIRLINE, true, undefined, false))).toBe(false)
    expect(or(mirrorTerms(HAIRLINE, false, undefined, false))).toBe(false)
    const t = mirrorTerms(HAIRLINE, true, undefined, true)
    expect(t.viaBusDocument).toBe(true)
    expect(t.viaMirrorUrl).toBe(false)
    expect(t.viaNotByDocument).toBe(false)
  })

  it('records "no mirror in flight" as null, and the key survives JSON — it must not read as "not recorded"', () => {
    const t = mirrorTerms(HAIRLINE, true, undefined, false)
    expect(t.mirrorRequested).toBeNull()
    // `undefined` would be dropped by JSON.stringify, and the guard print is JSON.
    const round = JSON.parse(JSON.stringify(t)) as Record<string, unknown>
    expect('mirrorRequested' in round).toBe(true)
    expect(round['mirrorRequested']).toBeNull()
  })

  it('carries exactly the six fields the guard print is read for, and no more', () => {
    // Six since the fix: `answeredOwnStart` is printed beside the others because it is now
    // part of the decision, and a term that decides without being printed would put the guard
    // print back to describing less than it judges.
    expect(Object.keys(mirrorTerms(HAIRLINE, true, HAIRLINE, false)).sort()).toEqual([
      'answeredOwnStart',
      'byDocument',
      'mirrorRequested',
      'viaBusDocument',
      'viaMirrorUrl',
      'viaNotByDocument',
    ])
  })

  it("the measured case: the commit answered the page's own start, so it is NOT the bus's", () => {
    // The page's own start for hairline.html, answered by this commit, while the bus's
    // mirrored load of the same address is in flight.
    const t = mirrorTerms(HAIRLINE, true, HAIRLINE, false, 1_000)
    expect(t.viaMirrorUrl).toBe(true)
    expect(t.answeredOwnStart).toBe(true)
    // Before the fix this was true, ipc.ts dropped the commit, and a redirect the user
    // could see went unreported.
    expect(isBusCommit(t)).toBe(false)
  })

  it('does not compare start TIMES, because an older mirror of the address is not this commit', () => {
    // Print 4, replayed through the real class by Idris: a mirrored start of the address
    // 677 ms BEFORE the page's own redirect made the time comparison answer false for a
    // genuine page-first redirect. The term reads which start was answered, nothing else.
    const t = mirrorTerms(HAIRLINE, true, HAIRLINE, false, 1_754)
    expect(t.answeredOwnStart).toBe(true)
    expect(isBusCommit(t)).toBe(false)
  })

  it("the other half: the bus's own mirrored load to the same address is still the bus's", () => {
    // A commit that answered the BUS's own start passes no own-start time, so the term is
    // false and the mirror still stamps — this is the double-count the fix must not open up.
    const busStart = mirrorTerms(HAIRLINE, true, HAIRLINE, false, null)
    expect(busStart.answeredOwnStart).toBe(false)
    expect(isBusCommit(busStart)).toBe(true)

    const noInitiator = mirrorTerms(HAIRLINE, false, HAIRLINE, false, 1_000)
    expect(noInitiator.answeredOwnStart, 'the bus\'s load is never document-initiated').toBe(false)
    expect(isBusCommit(noInitiator)).toBe(true)
  })


})
