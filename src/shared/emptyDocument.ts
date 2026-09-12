/**
 * A measurement of a document with nothing in it.
 *
 * booking.com's mobile page is empty at `load` and rendered by script in the
 * next second. The audit ran the moment the load and the walk were done and
 * answered zero targets, zero text, a page one viewport tall — and no
 * warning: an empty document reported like a clean page. A render waits for
 * paints to go quiet and so saw the page; a measurement asks the DOM once.
 *
 * This is the measurement's version of the blank-frame rule (`shared/paint`):
 * a report with nothing in it is held for a grace, re-asked every poll, and
 * answered with a warning if it is still empty at the end — a page rendered
 * by script that had not run, a bot wall, or a page with nothing on it.
 * Pure, so the runners (CLI and app) share it and it is unit-tested with an
 * injected clock.
 */

/** How long an empty document is held for before it is measured as empty. */
export const EMPTY_GRACE_MS = 3_000
/** How often it is re-asked meanwhile. */
export const EMPTY_POLL_MS = 250

/** An audit report with no target and no text element. */
/** Whether the checks refused anything: an absent or all-zero block has not. */
const anyDropped = (dropped: Record<string, number | undefined> | undefined): boolean =>
  dropped !== undefined && Object.values(dropped).some(n => (n ?? 0) > 0)

export function isEmptyAuditReport(report: { targets: unknown[]; text: unknown[]; dropped?: Record<string, number | undefined> }): boolean {
  // A report the checks emptied is not an empty document: the page had
  // content and the measurement refused it, which its own warning says.
  // Reading it as "renders late" would hold the page for the grace period
  // and then tell the reader something untrue about their page.
  if (anyDropped(report.dropped)) return false
  return report.targets.length === 0 && report.text.length === 0
}

/** A lint report with no text, no edge and no image. */
export function isEmptyLintReport(report: {
  text: unknown[]
  edges: unknown[]
  images: unknown[]
  dropped?: Record<string, number | undefined>
}): boolean {
  if (anyDropped(report.dropped)) return false
  return report.text.length === 0 && report.edges.length === 0 && report.images.length === 0
}

/** The iframes in the viewport and how much of it they cover (`framesInViewport` in shared/scrollHost). */
export interface FrameCoverage {
  count: number
  viewportCoverage: number
}

/**
 * The sentence a measurement of nothing carries. With `frames`, it names the
 * iframes the visible page is: the measurement does not enter them, and a
 * bot wall (etsy.com behind DataDome) is one iframe over the whole viewport —
 * without the clause the reader took the wall for a blank page while the
 * snap showed a heading and a slider.
 */
export function emptyDocumentNote(what: 'audit' | 'lint', waitedMs: number, frames?: FrameCoverage, shadow?: ShadowContent): string {
  const measured = what === 'audit' ? 'no visible text and no targets' : 'no visible text, edges or images'
  // How long the document was held, not a time since some event: a page
  // that navigated makes "after it loaded" ambiguous about which load.
  const held = `and none arrived in the ${Math.round(waitedMs / 100) / 10} s it was held`
  // An iframe covering none of the viewport is neither a wall nor an embed
  // worth naming: chromestatus.com carries one, and "an <iframe> covers 0% of
  // the viewport — a bot wall or an embed" was noise beside the real cause.
  const coverage = frames === undefined ? 0 : Math.round(frames.viewportCoverage * 100)
  const framed =
    frames !== undefined && frames.count > 0 && coverage > 0
      ? `; ${frames.count === 1 ? 'an <iframe> covers' : `${frames.count} <iframe>s cover`} ${coverage}% of the viewport, ` +
        `which the measurement does not enter — a bot wall or an embed, not a blank page`
      : ''
  // A page built from web components is not empty, not slow and not a bot
  // wall, and it will never fill however long it is given: its content is in
  // shadow roots the measurement does not enter (chromestatus.com, measured
  // 2026-09-12 — 159 roots holding 136 interactive elements, reported as
  // "nothing to measure" with three causes, all false). Say the true one and
  // drop the guesses, including the advice to wait, which cannot help here.
  if (shadow !== undefined && shadow.hosts > 0 && shadow.interactive + shadow.text > 0) {
    const roots = shadow.hosts === 1 ? '1 shadow root ' : `${shadow.hosts} shadow roots `
    const holds = [
      shadow.interactive > 0 ? `${shadow.interactive} interactive element${shadow.interactive === 1 ? '' : 's'}` : null,
      shadow.text > 0 ? `${shadow.text} text element${shadow.text === 1 ? '' : 's'}` : null,
    ]
      .filter((p): p is string => p !== null)
      .join(' and ')
    return (
      `nothing to measure in the light DOM: the page had ${measured}, ${held}, but ${roots}` +
      `hold ${holds} the measurement does not enter — this page is built from web components, not empty, ` +
      `and no wait brings it into the light DOM; the figures are of the light DOM alone` +
      framed
    )
  }
  return (
    `nothing to measure: the page had ${measured}, ${held} — ` +
    `a page rendered by script that had not run yet, a bot wall, or an empty document; ` +
    `the figures are of an empty page, and waitMs (--wait) gives a page that renders late longer` +
    framed
  )
}

/**
 * What the open shadow roots on the page hold, counted by `shadowContent`
 * in shared/scrollHost. The measurement reads the light DOM, so a page whose
 * content lives in components measures as nothing; these counts are how the
 * answer says that rather than guessing at bot walls.
 */
export interface ShadowContent {
  /** Open shadow hosts found, nested ones included. */
  hosts: number
  /** Interactive elements inside them — what the audit would have measured. */
  interactive: number
  /** Elements with text of their own inside them. */
  text: number
}

export interface AwaitContentOptions {
  graceMs?: number
  pollMs?: number
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}

export interface AwaitContentOutcome<T> {
  /** The last report taken, null when the page never answered. */
  report: T | null
  /** How long the document was held for, 0 when the first report had content. */
  waitedMs: number
  /** True when the grace ran out on an empty document. */
  stillEmpty: boolean
  /** True when the first report was empty and a later one was not. */
  arrived: boolean
}

/**
 * Takes a report, and while it is empty takes another every poll until the
 * grace runs out. `measure` answering null (the page did not answer) ends the
 * wait as it stands.
 */
export async function awaitContent<T>(
  measure: () => Promise<T | null>,
  isEmpty: (report: T) => boolean,
  options: AwaitContentOptions = {},
): Promise<AwaitContentOutcome<T>> {
  const graceMs = options.graceMs ?? EMPTY_GRACE_MS
  const pollMs = options.pollMs ?? EMPTY_POLL_MS
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>(done => setTimeout(done, ms)))
  const now = options.now ?? (() => Date.now())
  const started = now()
  let report = await measure()
  if (report === null || !isEmpty(report)) return { report, waitedMs: 0, stillEmpty: false, arrived: false }
  while (now() - started < graceMs) {
    await sleep(Math.min(pollMs, Math.max(0, graceMs - (now() - started))))
    report = await measure()
    if (report === null) return { report, waitedMs: now() - started, stillEmpty: false, arrived: false }
    if (!isEmpty(report)) return { report, waitedMs: now() - started, stillEmpty: false, arrived: true }
  }
  return { report, waitedMs: now() - started, stillEmpty: true, arrived: false }
}
