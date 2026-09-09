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
