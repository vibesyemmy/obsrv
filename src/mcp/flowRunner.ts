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
}

export interface FlowRunResult {
  steps: FlowStepResult[]
}

export interface FlowRunnerDeps {
  /** One control-protocol command against the held session. */
  call: (command: string, payload?: Record<string, unknown>) => Promise<Record<string, unknown>>
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
    const { action, target, ...rest } = step

    if (stopped) {
      steps.push({ index, action, ...(target !== undefined ? { target } : {}), status: 'not-reached' })
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
    const result = await runFlow(flow, { call: deps.call })
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
