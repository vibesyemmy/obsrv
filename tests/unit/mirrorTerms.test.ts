import { describe, expect, it } from 'vitest'
import { mirrorTerms, type MirrorTerms } from '../../src/shared/mirrorTerms'

/**
 * `mirrorTerms` records which term stamped a commit as the bus's
 * (`bug-redirect-note-missing-not-late`). It must **agree with the decision it describes** and
 * must **never be the decision**: `TargetSource` still computes `fromBus` itself.
 *
 * `ORACLE` below is the decision expression copied verbatim from `targetSource.ts` —
 * `isMirrorCommit`'s body, and the `fromBusDocument` arm of the `did-navigate` handler:
 *
 *   isMirrorCommit(url, byDocument):
 *     if (this.mirrorRequested === undefined) return false
 *     return url === this.mirrorRequested || !byDocument
 *   fromBus = this.isMirrorCommit(url, byDocument) || (byDocument && start?.fromBusDocument === true)
 *
 * It is a COPY, because `isMirrorCommit` is private to a class that needs Electron to build, so
 * this test cannot call the real one. That is a stated limit, not a hidden one: if the real
 * expression changes and this oracle does not, this test goes on passing. The runtime backstop is
 * the e2e guard print, which carries `mirroring` (the real decision) beside the recorded terms —
 * a disagreement is visible there. Change the two together.
 */
const ORACLE = (url: string, byDocument: boolean, mirrorRequested: string | undefined, startFromBusDocument: boolean): boolean => {
  const isMirrorCommit = (): boolean => {
    if (mirrorRequested === undefined) return false
    return url === mirrorRequested || !byDocument
  }
  return isMirrorCommit() || (byDocument && startFromBusDocument)
}

const HAIRLINE = 'file:///fixtures/hairline.html'
const REDIRECT = 'file:///fixtures/redirect.html'
const or = (t: MirrorTerms): boolean => t.viaMirrorUrl || t.viaNotByDocument || t.viaBusDocument

describe('mirrorTerms', () => {
  it('reproduces the decision over its whole truth table, so recording can never contradict it', () => {
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
          expect(or(t), `${label}, byDocument=${byDocument}, fromBusDocument=${startFromBusDocument}`).toBe(
            ORACLE(HAIRLINE, byDocument, mirrorRequested, startFromBusDocument),
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

  it('carries exactly the five fields the guard print is read for, and no more', () => {
    expect(Object.keys(mirrorTerms(HAIRLINE, true, HAIRLINE, false)).sort()).toEqual([
      'byDocument',
      'mirrorRequested',
      'viaBusDocument',
      'viaMirrorUrl',
      'viaNotByDocument',
    ])
  })
})
