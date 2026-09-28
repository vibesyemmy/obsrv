/**
 * The real `FlowRunnerDeps.observe` (`flowRunner.ts`): turns a validated
 * flow's stated observations into the exact-text reader's control command
 * (`observeText` — `shared/observe.ts` + `shared/control.ts` +
 * `main/controlServer.ts`), and its untrusted reply back into the runner's
 * own `ObservationReading` shape.
 *
 * Deliberately thin. Every actual decision (present/absent/unknown, and
 * what counts as a complete-enough read to claim absence) already lives in
 * `flowRunner.ts`'s `recordObservations`; this only has to answer its three
 * questions honestly per stated text — was it found rendered, was the read
 * complete enough to trust an absence, and what did it look at.
 */

import { parseObserveReport, type ObserveRequest } from '../shared/ipcPayloads'
import type { ObservationReading } from './flowRunner'

/**
 * Closed shadow roots are, by construction, invisible to any page script —
 * `attachShadow({ mode: 'closed' })` returns no handle even to code running
 * in the page, so whether one exists, let alone what it contains, cannot be
 * asked for. Stated once, unconditionally, rather than varying it by a
 * guess: staying silent whenever none happen to be detected would just be
 * the same false completeness this whole feature exists to refuse, dressed
 * up as an omission instead of a claim.
 */
const CLOSED_SHADOW_CAVEAT = 'closed shadow roots, if the page has any, are never reachable from a page script and are not reflected in this'

function lookedSentence(finding: { renderedCount: number; unrenderedCount: number }, frames: { count: number; viewportCoverage: number } | undefined): string {
  const frameNote =
    frames !== undefined && frames.count > 0
      ? ` (${frames.count} iframe${frames.count === 1 ? '' : 's'} in view, covering ${Math.round(frames.viewportCoverage * 100)}% of it, not searched)`
      : ''
  const unrenderedNote =
    finding.unrenderedCount > 0
      ? `; ${finding.unrenderedCount} more match${finding.unrenderedCount === 1 ? '' : 'es'} exist in the DOM but ${finding.unrenderedCount === 1 ? 'is' : 'are'} not rendered`
      : ''
  return (
    `searched the rendered page${frameNote}: ${finding.renderedCount} rendered match${finding.renderedCount === 1 ? '' : 'es'}${unrenderedNote} ` +
    `(${CLOSED_SHADOW_CAVEAT})`
  )
}

/**
 * Wraps one control-protocol `call` into `FlowRunnerDeps.observe`. A
 * rejected `call` (the control server's own 409 for a page that never
 * answered, same as `audit`/`lint`) is left to propagate — `recordObservations`'s
 * own `try/catch` is what turns that into `unknown` for every stated text,
 * so this function does not duplicate that decision.
 */
export function observeViaControl(
  call: (command: string, payload?: Record<string, unknown>) => Promise<Record<string, unknown>>,
): (texts: string[]) => Promise<ObservationReading[]> {
  return async (texts: string[]): Promise<ObservationReading[]> => {
    const req: ObserveRequest = { texts }
    const raw = await call('observeText', req)
    const report = parseObserveReport(raw)
    if (report === null) throw new Error('observeText answered a report the checks refused')
    // Complete only when nothing structurally went unsearched. The closed-
    // shadow caveat above is a standing limitation of the reader itself, not
    // a per-run fact, so it rides along in every sentence but never gates
    // this — exactly as it is never counted in `frames` either.
    const complete = (report.frames?.count ?? 0) === 0
    return texts.map((text, i): ObservationReading => {
      const finding = report.findings[i]
      if (finding === undefined || finding.text !== text) {
        return { found: false, complete: false, looked: 'the reader did not answer for this text, so nothing can be said either way' }
      }
      const found = finding.renderedCount > 0
      return {
        found,
        complete,
        looked: lookedSentence(finding, report.frames),
        ...(found ? { saw: finding.matches.map(m => m.element) } : {}),
      }
    })
  }
}
