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
import { resolveFlowText, type ClauseResolution } from '../shared/flowLanguage'
import { flowRefusalMessage, type FlowRunResult, type FlowRunnerDeps, type StartFlowResult } from './flowRunner'
import { observeViaControl } from './flowObserve'
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
export function flowReportSteps(flow: Flow, result: FlowRunResult, resolutions?: ClauseResolution[]): FlowReportStep[] {
  return result.steps.map((s, i) => {
    const declared = flow.steps[i]
    // One clause became one step, in order, which is what makes this index join
    // true — see `flowLanguage`'s own note on it.
    const from = resolutions?.[i]
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
      ...(s.network !== undefined ? { network: s.network } : {}),
      // Passed straight through: the runner made these decisions and recorded
      // what it measured, and a second reading here would be a second opinion.
      ...(s.resolved !== undefined ? { clickedAt: s.resolved } : {}),
      // The masking decision is the runner's, made once, against the fact it
      // had in hand (the resolved element's own inputType) at the moment it
      // typed — not remade here from a copy of that fact, which is exactly
      // the shape of bug this feature exists to avoid one level up.
      ...(s.typed !== undefined ? { typed: s.typed } : {}),
      // What Obsrv understood this step to be, when a sentence produced it.
      // Prominent in the report rather than one click down: it is what separates
      // "Obsrv misunderstood step 2" from "step 2 is broken".
      ...(from !== undefined ? { clause: from.clause, keyedOn: from.keyedOn } : {}),
    }
  })
}

/** A flow given as a step list, or as a sentence to resolve into one. Exactly
 *  one: a caller who sends both has two intentions and Obsrv should not pick. */
export interface FlowToolInput {
  steps?: unknown
  description?: unknown
}

/**
 * Turns whichever form was given into a validated flow, plus — for a resolved
 * description — what each clause became.
 *
 * `resolveFlowText` returns `validateFlow`'s own output, so "the steps a
 * description produces are steps the runner accepts" holds by construction and
 * not by two functions agreeing.
 */
function flowFrom(input: FlowToolInput): { ok: true; flow: Flow; resolutions?: ClauseResolution[] } | { ok: false; error: string } {
  const hasSteps = input.steps !== undefined
  const hasText = input.description !== undefined
  if (hasSteps && hasText) {
    // Refuse rather than prefer one. A caller who sent both either changed
    // their mind or built the payload wrongly, and running the half Obsrv
    // happens to check first would hide that.
    return { ok: false, error: 'the flow was not run: give either `steps` or `description`, not both — they are two different flows and Obsrv will not choose between them' }
  }
  if (!hasSteps && !hasText) {
    return { ok: false, error: 'the flow was not run: it needs either `steps` (a list of actions) or `description` (what to do, in your own words)' }
  }
  if (hasText) {
    if (typeof input.description !== 'string') {
      return { ok: false, error: 'the flow was not run: `description` must be a string — what you want driven, in your own words' }
    }
    const resolved = resolveFlowText(input.description)
    if (!resolved.ok) {
      // Each rejection names its own clause, so the caller sees which words
      // Obsrv could not turn into a step rather than a count of failures.
      const lines = resolved.rejections.map(r => `  - ${r.clause === '' ? '(the whole description)' : `"${r.clause}"`}: ${r.reason}`).join('\n')
      return { ok: false, error: `the flow was not run, because these could not be resolved into steps:\n${lines}` }
    }
    return { ok: true, flow: resolved.flow, resolutions: resolved.resolutions }
  }
  const parsed = validateFlow(input.steps)
  if (!parsed.ok) {
    // Every rejection, not the first: a caller fixing a step list wants all of
    // its problems at once, which is why `validateFlow` collects them.
    const lines = parsed.rejections.map(r => `  - ${r.reason}`).join('\n')
    return { ok: false, error: `the flow was not run, because its steps did not validate:\n${lines}` }
  }
  return { ok: true, flow: parsed.flow }
}

/**
 * The runner's dependencies, built from one control call.
 *
 * **Extracted so that "a reader is supplied" is testable.** It was not, and the
 * consequence shipped: `FlowRunnerDeps.observe` is optional, `#482` landed the
 * reader, and for a while **nothing passed it** — so every stated expectation in
 * every flow report read `unknown — no reader was configured for this run`. The
 * feature's central sentence was unreachable and no test could notice, because
 * the wiring lived inside a closure in `server.ts` that no unit test can reach.
 *
 * `flowRunnerDeps.test.ts` now asserts the reader is here and that it issues
 * `observeText`. That guard is bought by that defect.
 */
export function flowRunnerDeps(call: FlowRunnerDeps['call']): FlowRunnerDeps {
  return { call, observe: observeViaControl(call) }
}

export async function runFlowTool(input: FlowToolInput, deps: FlowToolDeps): Promise<FlowToolOutcome> {
  const made = flowFrom(input)
  if (!made.ok) return { ok: false, error: made.error }
  const { flow, resolutions } = made

  const started = await deps.start(flow)
  if (!started.ok) {
    // A refusal is not a failed flow: nothing ran, so there is nothing to
    // report on. The message names who holds the app and for how long.
    return { ok: false, error: flowRefusalMessage(started.refused) }
  }

  const reportSteps = flowReportSteps(flow, started.result, resolutions)
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
