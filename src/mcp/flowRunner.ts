/**
 * The step-runner: drives a validated flow (`src/shared/flow.ts`) over ONE
 * held control session, issuing each step's existing control command in
 * sequence — no new IPC, no new protocol.
 *
 * "Held" is what N independent `obsrv_drive` calls are not: each of those
 * re-resolves the live app from scratch, which is exactly where
 * `bug-canvas-blank-without-notice` and `bug-ipc-native-pane-invisible-once`
 * are hardest to diagnose, mid-flow with no single obvious repro. Holding
 * one session means `deps.call` is resolved once, by the caller, against one
 * `ControlInfo`, and every step in the flow goes through that same function.
 */

import type { Flow, FlowStep } from '../shared/flow'
import { acquireFlowLock, defaultFlowLockDeps, releaseFlowLock, type AcquireFlowLockResult, type FlowLockDeps, type FlowLockHolder } from './flowLock'

export type { FlowLockDeps, FlowLockHolder }

/**
 * `ran`: the step's own action call succeeded (its settle check may still
 * have failed — that only means `settled`/`unsettledReason` are absent).
 * `failed`: the step's own action call rejected.
 * `not-reached`: a step never ran because an earlier one failed — its own
 * distinct state, not merely absent, so a reader can never mistake "not
 * attempted" for "not in the flow". The report's front page is specified to
 * lead with what was not covered; it cannot state that from data that does
 * not contain it.
 */
export type FlowStepStatus = 'ran' | 'failed' | 'not-reached'

/**
 * What a stated observation came to. Never pass or fail: an `absent` is
 * something for the QA engineer to read, not a verdict Obsrv pronounces.
 *
 * `present` and `absent` are the only two that claim to know, and `absent`
 * claims it only when the read was complete. `unknown` is everything the
 * runner could not honestly say — the step failed, the page had not
 * settled, the read failed or was cut short — and it is never collapsed
 * into `absent`, because a frame that had not finished painting cannot say
 * something is missing. `not-reached` is a step that never ran, never an
 * implied `absent`.
 */
export type ObservationState = 'present' | 'absent' | 'unknown' | 'not-reached'

export interface ObservationRecord {
  /** The text the QA engineer stated, verbatim. */
  expected: string
  state: ObservationState
  /** Where it looked and, for anything but a plain `present`, what it could
   *  not see or why it did not look. A sentence rather than a code, because
   *  the report prints it: "absent" must stay distinguishable from "looked
   *  somewhere the thing could not be". */
  looked: string
  /** What Obsrv saw where it matched, when the reader has it: the matching
   *  text. An `absent` carries none — nothing measures what was there
   *  instead, and inventing it would be a claim nobody took a reading for. */
  saw?: string[]
}

/** What one read of the page says about one stated text. The reader is
 *  injected because how a page is read is a separate decision from how a
 *  run records it; the runner decides the state from these three facts. */
export interface ObservationReading {
  found: boolean
  /** True when everything the reader is able to read was read. False when it
   *  was cut (a cap, a truncated snippet): a string not found on an incomplete
   *  read is unknown, never absent. */
  complete: boolean
  looked: string
  saw?: string[]
}

export interface FlowStepResult {
  index: number
  action: FlowStep['action']
  target?: string
  status: FlowStepStatus
  /** The step's own control-server reply, when it ran. */
  reply?: Record<string, unknown>
  /** The step's own call's rejection message, when it failed. */
  error?: string
  /** Whether the page had stopped moving by the time this step's settle
   *  check ran — the same fields `obsrv_capture` already emits, threaded
   *  through per step rather than only at the end. Read on a failed step
   *  too: whether the page was still animating when the action failed
   *  distinguishes a timing problem from a settled-page defect. Absent when
   *  the step never ran at all (`not-reached`), or the settle check itself
   *  could not be answered. */
  settled?: boolean
  unsettledReason?: string
  /** The settle check's own capture, base64 PNG — `captureRaster` produces
   *  one to answer `settled` whether or not anything asked for it, so this
   *  reuses it rather than paying for (and re-perturbing timing with) a
   *  second capture when a per-step image is wanted later. */
  data?: string
  /** One record per observation the step stated, in the order stated. Absent
   *  (not empty) for a step that stated none, so a flow without observations
   *  produces exactly the result it always did. */
  observations?: ObservationRecord[]
}

export interface FlowRunResult {
  steps: FlowStepResult[]
}

export interface FlowRunnerDeps {
  /** One control-protocol command against the held session. */
  call: (command: string, payload?: Record<string, unknown>) => Promise<Record<string, unknown>>
  /** Reads the page for the given stated texts, answering one reading per text
   *  in the same order. Called once per step, after the step has settled and
   *  never before. Without one, every observation is `unknown`. */
  observe?: (texts: string[]) => Promise<ObservationReading[]>
}

const NOT_REACHED = 'the step was not reached, so nothing was read'

/** The state and account for every stated text on a step that did run. Reads
 *  only a step that ran and settled: a failed step's screen is kept elsewhere
 *  but what it was meant to show was not examined, and an unsettled or
 *  unverified frame cannot honestly say something is missing. */
async function recordObservations(
  texts: string[],
  step: { failed: boolean; settled: boolean | undefined; unsettledReason: string | undefined },
  observe: FlowRunnerDeps['observe'],
): Promise<ObservationRecord[]> {
  const unknown = (looked: string): ObservationRecord[] => texts.map(expected => ({ expected, state: 'unknown', looked }))
  if (step.failed) return unknown('the step failed, so what it was meant to show was not examined')
  if (step.settled === false) {
    return unknown(`the page had not settled (${step.unsettledReason ?? 'no reason given'}) when this step finished, so nothing was read`)
  }
  if (step.settled === undefined) {
    return unknown("the step's settle state could not be read, so nothing was read: a missing result would not be honest")
  }
  if (observe === undefined) return unknown('no reader was configured for this run, so nothing was read')
  let readings: ObservationReading[]
  try {
    readings = await observe(texts)
  } catch (e) {
    return unknown(`the read failed (${e instanceof Error ? e.message : String(e)}), so nothing can be said either way`)
  }
  return texts.map((expected, i): ObservationRecord => {
    const r = readings[i]
    if (r === undefined) return { expected, state: 'unknown', looked: 'the reader did not answer for this text, so nothing can be said either way' }
    return {
      expected,
      state: r.found ? 'present' : r.complete ? 'absent' : 'unknown',
      looked: r.looked,
      ...(r.saw !== undefined ? { saw: r.saw } : {}),
    }
  })
}

/** Runs every step of a validated flow in sequence over the one `call`
 *  given — nothing here re-resolves the app per step. Stops running at the
 *  first step whose own action call rejects: later steps assume the flow
 *  reached a particular point, and running them against an unknown app
 *  state would report on a flow that never actually happened. Every step
 *  still gets a result — the ones after a failure are recorded as
 *  `not-reached` rather than left out. */
export async function runFlow(flow: Flow, deps: FlowRunnerDeps): Promise<FlowRunResult> {
  const steps: FlowStepResult[] = []
  let stopped = false
  for (let index = 0; index < flow.steps.length; index++) {
    const step = flow.steps[index]!
    const { action, target, observations, ...rest } = step
    const stated = observations !== undefined && observations.length > 0 ? observations : undefined

    if (stopped) {
      steps.push({
        index,
        action,
        ...(target !== undefined ? { target } : {}),
        status: 'not-reached',
        ...(stated !== undefined ? { observations: stated.map(expected => ({ expected, state: 'not-reached' as const, looked: NOT_REACHED })) } : {}),
      })
      continue
    }

    const payload = target !== undefined ? { target, ...rest } : rest

    let reply: Record<string, unknown> | undefined
    let error: string | undefined
    try {
      reply = await deps.call(action, payload)
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    }

    // Run whether the step's own action succeeded or not: the screen at the
    // moment a step failed is the most useful artefact in a QA report, and
    // whether the page was still animating when it failed is a different
    // bug from the same click failing on a settled page. The probe is its
    // own try/catch, so a capture that cannot run on a broken app just
    // says nothing rather than turning the step's own failure into two.
    let settled: boolean | undefined
    let unsettledReason: string | undefined
    let data: string | undefined
    try {
      const capture = await deps.call('captureRaster', {})
      settled = typeof capture['settled'] === 'boolean' ? capture['settled'] : undefined
      unsettledReason = typeof capture['unsettledReason'] === 'string' ? capture['unsettledReason'] : undefined
      data = typeof capture['data'] === 'string' ? capture['data'] : undefined
    } catch {
      // Can't say — does not change the step's own ran/failed status.
    }

    const recorded =
      stated === undefined ? undefined : await recordObservations(stated, { failed: error !== undefined, settled, unsettledReason }, deps.observe)

    steps.push({
      index,
      action,
      ...(target !== undefined ? { target } : {}),
      status: error === undefined ? 'ran' : 'failed',
      ...(reply !== undefined ? { reply } : {}),
      ...(error !== undefined ? { error } : {}),
      ...(settled !== undefined ? { settled } : {}),
      ...(unsettledReason !== undefined ? { unsettledReason } : {}),
      ...(data !== undefined ? { data } : {}),
      ...(recorded !== undefined ? { observations: recorded } : {}),
    })

    if (error !== undefined) stopped = true
  }
  return { steps }
}

export interface FlowRefusal {
  heldBy: FlowLockHolder
  ageMs: number
}

export type StartFlowResult = { ok: true; result: FlowRunResult } | { ok: false; refused: FlowRefusal }

export interface StartFlowDeps extends FlowRunnerDeps {
  /** Defaults to the real, filesystem-backed lock beside `control.json`.
   *  Tests supply their own so a race can be simulated without touching a
   *  real file or a real process table. */
  lock?: FlowLockDeps
  now?: () => number
}

/** Acquires the flow lock, runs the flow, and releases the lock afterward —
 *  always, including when a step fails partway through. Refuses loudly,
 *  rather than queuing, when another flow already holds it. */
export async function startFlow(flow: Flow, deps: StartFlowDeps): Promise<StartFlowResult> {
  const lock = deps.lock ?? defaultFlowLockDeps()
  const acquired: AcquireFlowLockResult = await acquireFlowLock(lock)
  if (!acquired.ok) {
    const now = deps.now ? deps.now() : Date.now()
    return { ok: false, refused: { heldBy: acquired.heldBy, ageMs: now - Date.parse(acquired.heldBy.startedAt) } }
  }
  try {
    const result = await runFlow(flow, { call: deps.call, ...(deps.observe !== undefined ? { observe: deps.observe } : {}) })
    return { ok: true, result }
  } finally {
    await releaseFlowLock(lock)
  }
}

/** The refusal as a sentence, naming who holds it and for how long — a
 *  crashed runner's stale lock reads differently from a live flow because
 *  the age and pid are stated, not implied. */
export function flowRefusalMessage(refused: FlowRefusal): string {
  const secs = Math.max(0, Math.round(refused.ageMs / 1000))
  return (
    `a flow started ${secs}s ago by pid ${refused.heldBy.pid} holds this app; refused rather than queued, ` +
    `since a queued action would land at an unpredictable step boundary inside that flow.`
  )
}
