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

export function walkCoverageNote(walked: WalkedSummary | undefined, viewportHeightPx: number, pageHeightPx: number): string | null {
  if (walked === undefined || !walked.atEnd) return null
  if (!(viewportHeightPx > 0) || !(pageHeightPx > 0)) return null
  const covered = (walked.screenfuls + 1) * viewportHeightPx
  if (pageHeightPx <= covered + viewportHeightPx * COVERAGE_SLACK) return null
  const screens = Math.ceil(pageHeightPx / viewportHeightPx)
  return (
    `the walk saw the end after ${walked.screenfuls} screenful${walked.screenfuls === 1 ? '' : 's'} (${Math.round(covered)} CSS px), ` +
    `but the page measures ${Math.round(pageHeightPx)} CSS px (${screens} screenfuls): a modal or a locked scroll held the page, ` +
    `or it grew after the walk; the measurement is of the page as it stands, and nothing below ${Math.round(covered)} px was scrolled into view`
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
export const WALK_NOTHING_NOTE =
  "this page hides the document's overflow and has no scrollable container in its light DOM, so the walk had nothing to scroll: " +
  'content in an iframe, in a shadow root, or in a container that scrolls by transform (a virtualised list or editor) was not brought ' +
  'into view before measuring, and the figures are of the page as it first shows'

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
