/**
 * `obsrv_flow`'s composition, kept out of the registration so it can be run
 * without an app, a control server or an MCP client — the same reason
 * `flowRunner` takes its control call as a dependency rather than reaching for
 * one. The registration in `server.ts` is a thin wrapper over `runFlowTool`.
 *
 * What it composes, and nothing more: validate the steps, hold one session and
 * run them, turn the outcomes into a document. Each of those three already
 * exists and is tested on its own; this is the join, and the join is what had
 * no test in the first two cards.
 */

import { validateFlow, type Flow, type FlowStep } from '../shared/flow'
import { flowRefusalMessage, type FlowRunResult, type StartFlowResult } from './flowRunner'
import { flowReportHtml, type FlowReportStep } from '../cli/reportHtml'
import { flowCoverageNote } from '../shared/walkCoverage'

export interface FlowToolDeps {
  /** Acquires the flow lock, runs every step over one held session, releases. */
  start: (flow: Flow) => Promise<StartFlowResult>
  /** Writes the document and answers where it put it. */
  writeReport: (html: string) => Promise<string>
  /** The report's own timestamp, as an ISO string. */
  now: () => string
  version: string
}

export interface FlowToolStepSummary {
  step: number
  action: string
  target?: string
  status: 'ran' | 'failed' | 'not-reached'
  /** Absent when the step was never attempted, or when the settle check on a
   *  step that did run could not answer. */
  settled?: boolean
  unsettledReason?: string
  error?: string
}

export type FlowToolOutcome =
  | { ok: false; error: string }
  | {
      ok: true
      reportPath: string
      steps: FlowToolStepSummary[]
      /** The same sentence the report leads with, so an agent reading only the
       *  structured reply learns what the document does not cover. Null when
       *  every step was attempted and every one settled. */
      coverage: string | null
    }

/** What the QA engineer said they expected at a step, when they said anything.
 *  A step's passthrough is `unknown`, so a non-string `expect` is dropped
 *  rather than rendered as `[object Object]`. */
function expectationOf(step: FlowStep): string | undefined {
  const raw = (step as Record<string, unknown>)['expect']
  return typeof raw === 'string' && raw.trim().length > 0 ? raw : undefined
}

/** The address the report names, or `undefined` when the flow never navigates.
 *
 *  It returned a **sentence** before — "the page the app already had open" —
 *  which the header rendered into `<a href="...">`, making a broken link whose
 *  href was prose. Absence is the honest answer, and the renderer decides how
 *  to say it. A flow that drives a page the app already had open is the normal
 *  case for a QA engineer resuming work, not an edge.
 *
 *  Reads `url` as well as `target` because the control server's `navigate`
 *  takes `url`, while `target` is the field every other action uses and so the
 *  one a first flow reaches for. */
export function flowSubject(flow: Flow): string | undefined {
  const nav = flow.steps.find(s => s.action === 'navigate')
  if (nav === undefined) return undefined
  const raw = (nav as Record<string, unknown>)
  for (const key of ['url', 'target']) {
    const v = raw[key]
    if (typeof v === 'string' && v.trim().length > 0) return v
  }
  return undefined
}

/** Zips the declared steps onto the outcomes so the report can show what was
 *  asked beside what happened. The runner emits one outcome per declared step,
 *  in order, including the ones it never attempted — so index is the join. */
export function flowReportSteps(flow: Flow, result: FlowRunResult): FlowReportStep[] {
  return result.steps.map((s, i) => {
    const declared = flow.steps[i]
    const expect = declared !== undefined ? expectationOf(declared) : undefined
    return {
      action: s.action,
      ...(s.target !== undefined ? { target: s.target } : {}),
      status: s.status,
      ...(s.error !== undefined ? { error: s.error } : {}),
      ...(s.settled !== undefined ? { settled: s.settled } : {}),
      ...(s.unsettledReason !== undefined ? { unsettledReason: s.unsettledReason } : {}),
      ...(s.reply !== undefined ? { reply: s.reply } : {}),
      ...(s.data !== undefined ? { data: s.data } : {}),
      ...(expect !== undefined ? { expect } : {}),
      // Passed straight through, shape for shape. The runner already decided
      // each state and wrote the sentence explaining it; re-deriving either
      // here would give the report a second opinion on a reading it never took.
      ...(s.observations !== undefined ? { observations: s.observations } : {}),
      ...(s.page !== undefined ? { page: s.page } : {}),
    }
  })
}

export async function runFlowTool(steps: unknown, deps: FlowToolDeps): Promise<FlowToolOutcome> {
  const parsed = validateFlow(steps)
  if (!parsed.ok) {
    // Every rejection, not the first: a caller fixing a step list wants all of
    // its problems at once, which is why `validateFlow` collects them.
    const lines = parsed.rejections.map(r => `  - ${r.reason}`).join('\n')
    return { ok: false, error: `the flow was not run, because its steps did not validate:\n${lines}` }
  }
  const flow = parsed.flow

  const started = await deps.start(flow)
  if (!started.ok) {
    // A refusal is not a failed flow: nothing ran, so there is nothing to
    // report on. The message names who holds the app and for how long.
    return { ok: false, error: flowRefusalMessage(started.refused) }
  }

  const reportSteps = flowReportSteps(flow, started.result)
  const reportPath = await deps.writeReport(
    flowReportHtml({
      ...(flowSubject(flow) !== undefined ? { url: flowSubject(flow) } : {}),
      generatedAt: deps.now(),
      version: deps.version,
      steps: reportSteps,
    }),
  )
  return {
    ok: true,
    reportPath,
    coverage: flowCoverageNote(started.result.steps),
    steps: started.result.steps.map((s, i) => ({
      step: i + 1,
      action: s.action,
      ...(s.target !== undefined ? { target: s.target } : {}),
      status: s.status,
      ...(s.settled !== undefined ? { settled: s.settled } : {}),
      ...(s.unsettledReason !== undefined ? { unsettledReason: s.unsettledReason } : {}),
      ...(s.error !== undefined ? { error: s.error } : {}),
    })),
  }
}
