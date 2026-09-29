/**
 * How long each of a flow's steps is allowed, by what the step actually does.
 *
 * The first version of the runner's call adapter gave **every** command the
 * apply budget (5 s), because one `call` is bound once for the whole held
 * session. That is right for a click or a preset change and wrong for
 * everything slow, and the worst case was silent: the per-step settle probe is
 * `captureRaster`, which the dedicated capture path allows 30 s. At 5 s it
 * times out, the probe is caught and says nothing, and **every step in every
 * flow renders `unknown`** — the feature's own third state, fired always, for a
 * reason that reads as the page misbehaving rather than as a budget.
 *
 * `audit` and `lint` are the same shape one step down: the dedicated tools give
 * them 20 s and a flow gave them 5.
 *
 * The kinds are named here and the numbers stay in `server.ts`, so this is
 * testable without importing the server, and a new control command cannot
 * quietly inherit the shortest budget — `flowBudget.test.ts` asserts every
 * command in `CONTROL_COMMANDS` has a kind chosen on purpose.
 */

import { CONTROL_COMMANDS, type ControlCommand } from '../shared/control'

export type BudgetKind = 'status' | 'apply' | 'navigate' | 'measure' | 'capture'

/** Commands whose budget is not the apply budget, and why each differs. */
const KINDS: Partial<Record<ControlCommand, BudgetKind>> = {
  // Answers from memory; the dedicated path allows 2 s.
  status: 'status',
  // Hands back an already-buffered batch; nothing is measured or awaited.
  networkRecord: 'status',
  // A real page load. The dedicated tools allow the navigation budget plus
  // slack, not the apply budget.
  navigate: 'navigate',
  reload: 'navigate',
  back: 'navigate',
  forward: 'navigate',
  // Measurement over the whole rendered page: 20 s in `obsrv_audit`/`obsrv_lint`.
  audit: 'measure',
  lint: 'measure',
  // Rasterising the pane, holding painting while it settles: 30 s.
  captureVisible: 'capture',
  captureTarget: 'capture',
  captureRaster: 'capture',
}

/** The budget kind for a step's action. Anything not named above is an apply —
 *  a click, a scroll, a preset, a tab switch — which is what the apply budget
 *  exists for. */
export function budgetKindFor(command: string): BudgetKind {
  return KINDS[command as ControlCommand] ?? 'apply'
}

/** Every control command, with the kind this module gives it. Exported so the
 *  guard can assert the set is complete rather than sampling it. */
export function budgetKinds(): Array<{ command: ControlCommand; kind: BudgetKind }> {
  return CONTROL_COMMANDS.map(command => ({ command, kind: budgetKindFor(command) }))
}
