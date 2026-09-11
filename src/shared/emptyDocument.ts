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
export function isEmptyAuditReport(report: { targets: unknown[]; text: unknown[] }): boolean {
  return report.targets.length === 0 && report.text.length === 0
}

/** A lint report with no text, no edge and no image. */
export function isEmptyLintReport(report: { text: unknown[]; edges: unknown[]; images: unknown[] }): boolean {
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
export function emptyDocumentNote(what: 'audit' | 'lint', waitedMs: number, frames?: FrameCoverage): string {
  const measured = what === 'audit' ? 'no visible text and no targets' : 'no visible text, edges or images'
  const framed =
    frames !== undefined && frames.count > 0
      ? `; ${frames.count === 1 ? 'an <iframe> covers' : `${frames.count} <iframe>s cover`} ${Math.round(frames.viewportCoverage * 100)}% of the viewport, ` +
        `which the measurement does not enter — a bot wall or an embed, not a blank page`
      : ''
  return (
    `nothing to measure: the page had ${measured} ${Math.round(waitedMs / 100) / 10} s after it loaded — ` +
    `a page rendered by script that had not run yet, a bot wall, or an empty document; ` +
    `the figures are of an empty page, and waitMs (--wait) gives a page that renders late longer` +
    framed
  )
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
