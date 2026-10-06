import type { ControlStatus } from '../shared/control'

/**
 * The live `obsrv_drive` reply spreads the app's own control `status`, and this
 * is the one place that decides which of its keys a client is allowed to see.
 *
 * **Why it exists: the spread shipped a reply the published schema refused.**
 * The breaking release removed `orientation` from `driveOutputShape`, and the
 * handler still did `{ ...status, … }` — so every live drive call emitted an
 * `orientation` the schema did not declare. Each output schema is
 * `additionalProperties: false`, so a client that has called `tools/list` gets
 * **`-32602 Structured content does not match the tool's output schema`** on
 * every live drive: the tool is unusable for it. Caught by `#592`'s suite —
 * 29 failures across `mcp-live.spec.ts`, `cli-walk-limits.spec.ts` and
 * `throttle-refused.spec.ts` — and diagnosed by Idris from the log (room
 * #4067). **It took the live specs to catch, and this sentence used to say that
 * nothing else could — which was false.** Wren disproved it the same afternoon
 * with an HTTP stub answering `status` through `OBSRV_CONTROL_FILE`, no app and
 * no window, and that probe is now `tests/unit/driveReplyWired.test.ts`. What
 * is true is narrower and worth keeping: of the guards that existed *when the
 * break shipped*, none could see it — they read schemas and `tools/list`, and
 * the probes were headless, so **nothing built a reply**. The spread is the
 * only place in the server where a reply's keys come from somewhere other than
 * the handler that declares them.
 *
 * **Removed rather than re-declared**, because `docs/breaking-changes.md`
 * promises that *"a client reading `orientation` from an MCP reply finds it
 * absent"*. Declaring it again would make the register false.
 *
 * `rotated` carries the same fact for a caller (`rotatedFromOrientation`), so
 * nothing is lost: the word stays the app's internal vocabulary and the flag is
 * the published one.
 */
export const DRIVE_DROPPED_STATUS_KEYS = ['orientation'] as const

/**
 * `status` with the keys the drive schema does not declare taken out.
 *
 * A named function and not an inline destructure, so a unit test can drive the
 * thing the handler calls — `tests/unit/driveReplyDeclared.test.ts` compares
 * its keys against the **published** `obsrv_drive` output schema, which is what
 * a validating client holds. A new field on the app's status then fails that
 * test rather than every live drive call.
 *
 * **The wiring is guarded separately**, because that test cannot see it:
 * `tests/unit/driveReplyWired.test.ts` drives the built server against a stub
 * control server and reads the real reply, so restoring `...status` here fails
 * it (measured: it goes red while `driveReplyDeclared` stays green).
 */
export function driveReplyStatus(status: ControlStatus): Omit<ControlStatus, (typeof DRIVE_DROPPED_STATUS_KEYS)[number]> {
  const { orientation: _orientation, ...declared } = status
  return declared
}
