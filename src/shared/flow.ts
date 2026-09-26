/**
 * A flow: a validated list of steps, the shared vocabulary CLI, MCP and main
 * agree on for the QA-flow-report feature (`board/epics/qa-flow-reports.md`).
 * Same role `presets.ts` and `throttle.ts` already play — one shape, agreed
 * on once, rather than each surface inventing its own.
 *
 * Deliberately inert: no runner, no report, nothing live. This is the
 * artifact everything downstream consumes, and it has to be verifiable
 * without an app to drive.
 */

import { CONTROL_COMMANDS, isControlCommand, type ControlCommand } from './control'

export interface FlowStep {
  action: ControlCommand
  /** Optional handle for the step's target — a selector, a tab id, and so on;
   *  what it names depends on `action` and is the runner's concern, not this
   *  module's. */
  target?: string
  /** Whatever else the action needs, passed through unvalidated: this module
   *  agrees on the step's shape, not on each command's own payload. */
  [key: string]: unknown
}

export interface Flow {
  steps: FlowStep[]
}

export interface FlowStepRejection {
  /** -1 names the whole flow (the input was not a step array at all);
   *  every other value is the rejected step's index in the input array. */
  index: number
  reason: string
}

export type ValidateFlowResult = { ok: true; flow: Flow } | { ok: false; rejections: FlowStepRejection[] }

const typeOf = (v: unknown): string => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v)

/**
 * Tagged on `ok` rather than distinguished by which fields are present: a
 * step's passthrough fields are unvalidated and a QA-flow step's most likely
 * extra key is itself named `reason` (annotating why the step exists), which
 * would make `'reason' in result` misclassify a valid step as a rejection.
 * `ok`/`step`/`rejection` are this function's own keys, never the user's.
 */
type StepValidation = { ok: true; step: FlowStep } | { ok: false; rejection: FlowStepRejection }

function validateStep(step: unknown, index: number): StepValidation {
  if (typeof step !== 'object' || step === null || Array.isArray(step)) {
    return { ok: false, rejection: { index, reason: `step ${index} must be an object, got ${typeOf(step)}` } }
  }
  const record = step as Record<string, unknown>
  if (!('action' in record)) {
    return { ok: false, rejection: { index, reason: `step ${index} is missing "action"` } }
  }
  const { action } = record
  if (typeof action !== 'string') {
    return { ok: false, rejection: { index, reason: `step ${index}'s "action" must be a string, got ${typeOf(action)}` } }
  }
  if (!isControlCommand(action)) {
    return {
      ok: false,
      rejection: { index, reason: `step ${index}'s "action" (${action}) is not a known control command; valid: ${CONTROL_COMMANDS.join(', ')}` },
    }
  }
  if ('target' in record && record.target !== undefined && typeof record.target !== 'string') {
    return { ok: false, rejection: { index, reason: `step ${index}'s "target" must be a string, got ${typeOf(record.target)}` } }
  }
  return { ok: true, step: { ...record, action } as FlowStep }
}

/** Parses and validates a JSON step list off the wire, off disk, or off an
 *  agent's payload. Collects a rejection per bad step rather than stopping at
 *  the first, so a caller can fix every problem at once. */
export function validateFlow(input: unknown): ValidateFlowResult {
  if (!Array.isArray(input)) {
    return { ok: false, rejections: [{ index: -1, reason: `a flow must be a JSON array of steps, got ${typeOf(input)}` }] }
  }
  const steps: FlowStep[] = []
  const rejections: FlowStepRejection[] = []
  input.forEach((raw, index) => {
    const result = validateStep(raw, index)
    if (result.ok) steps.push(result.step)
    else rejections.push(result.rejection)
  })
  if (rejections.length > 0) return { ok: false, rejections }
  return { ok: true, flow: { steps } }
}
