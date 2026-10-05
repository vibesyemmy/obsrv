/**
 * Which term stamped a commit as the bus's — recorded, never decided here.
 *
 * `bug-redirect-note-missing-not-late`: in every failing sighting that carried the guard
 * print (13 of 13 over 2026-09-28 → 10-02), no commit after the caller's own `redirect.html`
 * survived `ipc.ts`'s `if (inPage || mirrored) return` — each was stamped `mirroring: true`,
 * so none reached the arrival count. `mirroring` is the OR of three terms and says nothing
 * about WHICH one fired; the log could not tell a page's own redirect that happened to land
 * on the address the bus was mirroring (`viaMirrorUrl`) from a commit with no document
 * initiator (`viaNotByDocument`) from a chain the bus began (`viaBusDocument`).
 *
 * **This exists to answer that, and it decides nothing.** `TargetSource` still computes
 * `fromBus` exactly as it did and still emits it; this is evaluated beside it from the same
 * inputs and written into the commit record, which `commitTrace()` returns and the e2e guard
 * prints. A reader seeing `mirroring` next to the three terms can check by eye that they agree.
 *
 * **The terms mirror `isMirrorCommit` and the `fromBusDocument` arm of `did-navigate`**
 * (`targetSource.ts`). `tests/unit/mirrorTerms.test.ts` pins them to a verbatim copy of that
 * expression over its whole truth table, so a change to one without the other is loud.
 */
export interface MirrorTerms {
  /**
   * The address the bus's in-flight mirrored load asked for **at the moment of this commit**,
   * or `null` when none was in flight. `loadMirrored` clears it in its `finally`, so it
   * cannot be read afterwards — that is why it is recorded rather than queried.
   *
   * `null`, not `undefined`: `JSON.stringify` drops `undefined`, and "no mirror was in flight"
   * must not read as "this field was not recorded" — the silence-that-fits-two-facts shape.
   */
  mirrorRequested: string | null
  /** Whether the document, not the bus, began this navigation (the matched start's `byDocument`). */
  byDocument: boolean
  /** A mirror was in flight and this commit reached the address it asked for. */
  viaMirrorUrl: boolean
  /** A mirror was in flight and this commit has no document initiator (a server-side redirect of the bus's load). */
  viaNotByDocument: boolean
  /** The navigation began in a document the bus placed, however late it landed. */
  viaBusDocument: boolean
  /**
   * The page's own (non-mirrored) start for this address began at or before the bus's
   * mirrored start for it — so this commit belongs to the navigation the DOCUMENT began,
   * which the bus then happened to mirror onto the same address.
   *
   * This is what `viaMirrorUrl` alone could not see. In all three instrument prints the
   * page's redirect started first (by 48 ms, then 25 ms, then 25 ms) and the bus's mirrored
   * load of the same address followed; `url === mirrorRequested` then claimed the page's own
   * commit and `ipc.ts` dropped it, so a redirect the user could see went unreported.
   */
  pageStartedFirst: boolean
}

export function mirrorTerms(
  url: string,
  byDocument: boolean,
  mirrorRequested: string | undefined,
  startFromBusDocument: boolean,
  /** When the page's own (non-mirrored) start for this address was recorded, or null. */
  ownStartAt: number | null = null,
  /** When the bus's mirrored start for this address was recorded, or null. */
  mirrorStartAt: number | null = null,
): MirrorTerms {
  const inFlight = mirrorRequested !== undefined
  return {
    mirrorRequested: mirrorRequested ?? null,
    byDocument,
    viaMirrorUrl: inFlight && url === mirrorRequested,
    viaNotByDocument: inFlight && !byDocument,
    viaBusDocument: byDocument && startFromBusDocument,
    // Only a document-initiated navigation can be the page's own; the bus's load is never
    // one. `<=` because the two can share a millisecond, and in that tie the document's
    // start is the one with an initiator.
    pageStartedFirst: byDocument && ownStartAt !== null && (mirrorStartAt === null || ownStartAt <= mirrorStartAt),
  }
}

/**
 * The decision itself: is this commit the bus's doing?
 *
 * **This used to live in `TargetSource.isMirrorCommit` with a verbatim COPY of it in
 * `tests/unit/mirrorTerms.test.ts`**, because the real one is private to a class that needs
 * Electron to build — and that test said so: *"if the real expression changes and this oracle
 * does not, this test goes on passing."* The expression is here now, so the test calls the
 * decision rather than a replica of it, and the two cannot drift.
 *
 * `viaMirrorUrl && !pageStartedFirst` is the fix for `bug-redirect-note-missing-not-late`:
 * reaching the address the bus asked for makes a commit the bus's **unless the page's own
 * navigation to it began first**, which is the measured case — and Opeyemi's decision
 * (2026-10-04, in session, on my recommendation) is that such a commit is an arrival.
 */
export function isBusCommit(terms: MirrorTerms): boolean {
  return (terms.viaMirrorUrl && !terms.pageStartedFirst) || terms.viaNotByDocument || terms.viaBusDocument
}
