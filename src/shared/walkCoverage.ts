/**
 * Whether the walk before a measurement covered the page it measured.
 *
 * theguardian.com opens under a full-screen consent layer that fixes the
 * body in place: the document's own scroll height collapses to the
 * viewport, the walk — headless and live alike — sees nowhere to go and
 * answers `screenfuls: 0, atEnd: true`, and the audit in the same call
 * measures 239 targets on a 20,596 px page behind the layer, which no finger
 * can reach, with no word about any of it. A page can also grow after the
 * walk (late hydration). Either way the walk vouched for a page it never
 * crossed. The measurement knows the page's height from the boxes it
 * measured; this compares the two. Pure, so it is tested.
 */
export interface WalkedSummary {
  screenfuls: number
  atEnd: boolean
}

/** Slack: a page up to half a screenful past what the walk covered is rounding, not a gap. */
const COVERAGE_SLACK = 0.5

/**
 * What the walk saw of the page it stopped on, for naming the cause rather
 * than offering the reader a list. `documentLocked` is the document hiding
 * its own overflow at the moment the walk stopped — the shape a modal's
 * scroll lock makes, including one that appears mid-walk. Absent when the
 * caller cannot tell (an older app), and the sentence then stays cautious.
 */
export interface WalkEnd {
  documentLocked?: boolean
  /**
   * What the walk measured holding the page, when it found nothing to
   * scroll. Not for naming the cause again — `walkNothingNote` does that,
   * better, in the sentence above — but for knowing that it *was* named, so
   * this one can stop offering a hedge for a page whose cause is on the
   * screen. Keyed off the measurement, not off the other sentence: a note
   * that is right because of its neighbour is waiting to be reordered.
   */
  blocked?: WalkBlocked
}

export function walkCoverageNote(
  walked: WalkedSummary | undefined,
  viewportHeightPx: number,
  pageHeightPx: number,
  end?: WalkEnd,
): string | null {
  if (walked === undefined || !walked.atEnd) return null
  if (!(viewportHeightPx > 0) || !(pageHeightPx > 0)) return null
  const covered = (walked.screenfuls + 1) * viewportHeightPx
  if (pageHeightPx <= covered + viewportHeightPx * COVERAGE_SLACK) return null
  const screens = Math.ceil(pageHeightPx / viewportHeightPx)
  // A page the walk actually scrolled, on a document that was not locked
  // when it stopped, was not held by anything: it grew under the walk, which
  // is what an endless feed does. Saying "a modal or a locked scroll" there
  // sends the reader after something that cannot be on the page (measured on
  // theguardian.com, spiegel.de and nytimes.com, 2026-09-12). A walk that
  // went nowhere reads as held whatever the flag says: zero screenfuls on a
  // tall page is the shape a lock makes, and it may be one this cannot see.
  const held = end?.documentLocked !== false || walked.screenfuls === 0
  // A wall was measured over the viewport, so the cause is not in doubt and
  // is already stated in full one line up. Offering "a modal or a locked
  // scroll held the page, or it grew after the walk" after it hedges what
  // has just been established, and the second half of that disjunction is a
  // page that grew — which a page that never moved did not do. Measured on
  // ft.com, run 15: the two sentences arrived together and the vaguer one
  // read as doubt about the first.
  const walled = (end?.blocked?.frames?.viewportCoverage ?? 0) >= FRAME_WALL_COVERAGE && (end?.blocked?.frames?.count ?? 0) > 0
  const cause = walled
    ? null
    : held
      ? 'a modal or a locked scroll held the page, or it grew after the walk'
      : 'the page grew as it was walked — a feed that extends as you scroll — so the end the walk saw was the end at the time'
  return (
    `the walk saw the end after ${walked.screenfuls} screenful${walked.screenfuls === 1 ? '' : 's'} (${Math.round(covered)} CSS px), ` +
    `but the page measures ${Math.round(pageHeightPx)} CSS px (${screens} screenfuls)${cause === null ? '' : `: ${cause}`}; ` +
    `the measurement is of the page as it stands, and nothing below ${Math.round(covered)} px was scrolled into view`
  )
}

/**
 * The walk's sentence for a page that hides the document's overflow and has
 * no scroller in its light DOM — a web player's shell, an editor that scrolls
 * by transform, a preview in an iframe (spotify.com on desktop, measured
 * 2026-09-11). The first `next` lands where the page already was, the walk is
 * right to stop, and `walked: { screenfuls: 0, atEnd: true }` alone read like
 * a one-screen page. The full-page capture says this in its own words; both
 * walks say it in these.
 */
export interface WalkBlocked {
  /** Iframes overlapping the viewport, and how much of it they cover. */
  frames?: { count: number; viewportCoverage: number }
  /** Open shadow hosts on the page (`shadowContent().hosts`). */
  shadowHosts?: number
}

/** A frame has to cover a real part of the screen before it explains one. */
const FRAME_WALL_COVERAGE = 0.5

/**
 * The walk's sentence for a page that hides the document's overflow and has
 * no scroller in its light DOM — a web player's shell, an editor that
 * scrolls by transform, a preview in an iframe (spotify.com on desktop,
 * measured 2026-09-11).
 *
 * It used to be a bare constant offering three causes: an iframe, a shadow
 * root, or a transform container. On ft.com it offered all three while the
 * measurement was holding the answer — one iframe covering 100% of the
 * viewport (a consent wall), and zero shadow hosts. `framesInViewport()` and
 * `shadowContent()` run on the same unconditional line as everything else
 * the walk sees, so the guesses were in front of a measured fact (run 15,
 * 2026-09-12). The same defect the empty-document note had before 0.57.0,
 * one function over. It names what was measured, and keeps the list only for
 * the case where nothing measured explains it.
 */
export function walkNothingNote(blocked?: WalkBlocked): string {
  const opening =
    "this page hides the document's overflow and has no scrollable container in its light DOM, so the walk had nothing to scroll: "
  const tail = ', and the figures are of the page as it first shows'
  const coverage = Math.round((blocked?.frames?.viewportCoverage ?? 0) * 100)
  const frameCount = blocked?.frames?.count ?? 0
  const hosts = blocked?.shadowHosts ?? 0
  // A frame over half the screen on a page that scrolls nothing is a wall,
  // and naming it is the whole point: "a consent wall or a paywall" is what
  // the reader does something about, where "content in an iframe" is a fact
  // about markup.
  if (frameCount > 0 && coverage >= FRAME_WALL_COVERAGE * 100) {
    return (
      `${opening}${frameCount === 1 ? 'an <iframe> covers' : `${frameCount} <iframe>s cover`} ${coverage}% of the viewport and the ` +
      `page beneath it did not move — a consent wall, a paywall or an onboarding layer holds it${tail}`
    )
  }
  if (hosts > 0) {
    return (
      `${opening}the page has ${hosts === 1 ? '1 open shadow root' : `${hosts} open shadow roots`}, which the walk does not enter, ` +
      `and nothing in the light DOM scrolls${tail}`
    )
  }
  if (frameCount > 0) {
    return (
      `${opening}${frameCount === 1 ? 'an <iframe> covers' : `${frameCount} <iframe>s cover`} ${coverage}% of the viewport, and what ` +
      `scrolls is either inside it or scrolls by transform (a virtualised list or editor)${tail}`
    )
  }
  // Nothing measured explains it: a frame was looked for and not found, a
  // root was looked for and not found. What is left is a container that
  // scrolls by transform, which cannot be counted from outside, so this one
  // case keeps a guess — one guess, about a page two facts have been ruled
  // out for.
  if (blocked?.frames !== undefined && blocked.shadowHosts !== undefined) {
    return (
      `${opening}no iframe covers the viewport and the page has no open shadow roots, so what scrolls is a container ` +
      `that scrolls by transform (a virtualised list or editor)${tail}`
    )
  }
  // And when the caller measured neither, say the list. "No iframe covers
  // the viewport" from a caller that never looked for one is the very defect
  // this function exists to remove: printed at the no-argument shape before
  // this branch existed, and it asserted both facts confidently.
  return (
    `${opening}content in an iframe, in a shadow root, or in a container that scrolls by transform (a virtualised ` +
    `list or editor) was not brought into view before measuring${tail}`
  )
}

/**
 * The sentence for a caller that has not measured what blocked the page — an
 * older app over the control socket. Same words the note carried before it
 * could name a cause, which is the honest thing to say when nothing was
 * looked at.
 */
export const WALK_NOTHING_NOTE = walkNothingNote()

/**
 * The walk's sentence for a page locked behind a dialog. A consent wall, a
 * paywall or an onboarding modal fixes the body in place, which leaves the
 * dialog's own panel as the only scroller in the light DOM — so the walk
 * scrolls *that*, and `walked: { screenfuls: 5, atEnd: true }` vouches for a
 * page it never moved (measured 2026-09-12 on a fixture, and on
 * airbnb.com's). Named dialog semantics only: a page locked by an anonymous
 * div says nothing here rather than the wrong thing.
 */
export function walkDialogNote(screenfuls: number): string {
  const walked =
    screenfuls === 0
      ? 'the dialog did not move either and the page never moved'
      : `the ${screenfuls} screenful${screenfuls === 1 ? ' ' : 's '}above ${screenfuls === 1 ? 'is' : 'are'} that dialog's and the page never moved`
  return (
    `the walk scrolled a dialog, not the page: this page hides the document's overflow while a dialog is open, so ${walked} — ` +
    `content the page loads as it scrolls, and anything below the first screen, was not brought into view before measuring`
  )
}
