import { z } from 'zod'

/**
 * An unknown key in a tool CALL is refused, naming the key and what the tool
 * does take — in production, for every client.
 *
 * **Why, and the case it was written for.** This release removes `orientation`
 * from the MCP surface in favour of `rotate` (`docs/breaking-changes.md`).
 * Without this, an agent that still sends `orientation: "landscape"` gets a
 * normal reply with `isError: false` and `warnings: []`, carrying a screen that
 * is not the one it asked for: the SDK parses arguments against a plain
 * `z.object`, and **zod drops unknown keys instead of failing**. The CLI
 * refuses the removed flag outright, so the two surfaces answered the same
 * question differently, and the MCP answer was the one the caller could not
 * detect — `docs/release-gate.md` class 1. Found by Wren and Idris, by two
 * independent probes (room #4019, #4022).
 *
 * **Why this ships for real users while `strictOutput.ts` stays fenced to
 * tests, which is not a contradiction.** That file's reasoning is about
 * replies: a client receiving a field it does not know is harmless, and
 * failing the call would punish the many clients that validate nothing. The
 * asymmetry is the point. An undeclared key in a reply is a field nobody
 * asked for; an unknown key in a request is *something the caller asked for
 * and did not get*. Only the second is a wrong answer, so only the second is
 * worth an error in production.
 *
 * **The limit, measured rather than implied: top level only.** `z.strictObject`
 * refuses unknown keys on the object it wraps, and nested input objects
 * (`obsrv_drive`'s steps, for one) still drop theirs silently. `orientation`
 * was only ever a top-level flag, so this closes the case it was written for
 * and no more. Do not read a green from it as "unknown input keys are
 * refused"; it says *unknown top-level input keys are refused*.
 *
 * **What it does not move.** `docs/public-shape.json` is generated from each
 * tool's **output** schema only (`scripts/public-shape.js:129`), so making
 * inputs strict does not register as a public-shape change there. It is still
 * caller-visible — the published `inputSchema` now carries
 * `additionalProperties: false` — so it owes the register an entry on its own
 * account, and has one.
 */

type Register = (name: unknown, config: unknown, handler: unknown) => unknown

/** A zod schema rather than a raw shape of them. The SDK's own test, inverted. */
const isSchema = (v: unknown): boolean =>
  typeof v === 'object' && v !== null && ((v as { _def?: unknown })._def !== undefined || (v as { _zod?: unknown })._zod !== undefined)

/**
 * A raw shape (`Record<string, ZodType>`) is the form every tool here
 * registers, and the only form worth converting. Anything already a schema is
 * left alone: its author chose its strictness, and silently re-wrapping it
 * would make this function the authority on a decision it cannot see.
 */
const isRawShape = (v: unknown): v is Record<string, unknown> => {
  if (typeof v !== 'object' || v === null || isSchema(v)) return false
  const values = Object.values(v)
  return values.length > 0 && values.every(isSchema)
}

/**
 * Which tools take `rotate`, filled in as they register.
 *
 * Read at CALL time, not at registration, so it is complete by the time any
 * refusal is written however the registrations are ordered. It exists because
 * **three tools do not take `rotate` at all** (`obsrv_diff`, `obsrv_presets`,
 * `obsrv_flow`), and the first version of this file told their callers to
 * "pass `rotate: true`" — advice that earns a second refusal, `unknown input
 * key \`rotate\``. Found by Wren on the pushed head (room #4041). A set built
 * from the shapes rather than a hard-coded list, so it cannot go stale when a
 * tool gains or loses the input.
 */
const rotateTools = new Set<string>()

/**
 * The sentence the caller reads. Written for an agent that has just been
 * refused: it names what was wrong, what the tool accepts instead, and — for
 * the key this exists for — where the rotation went.
 *
 * `rotate` is named explicitly rather than left to the accepted-keys list,
 * because the list does not say which of a dozen keys is the one that would
 * have turned the screen. On a tool that cannot rotate, the ones that can are
 * named instead: the caller's next call has to go somewhere.
 */
function refusal(tool: string, keys: readonly string[], accepted: readonly string[]): string {
  const elsewhere = [...rotateTools].sort().join(', ')
  const removed = !keys.includes('orientation')
    ? ''
    : accepted.includes('rotate')
      ? ' `orientation` was removed from this surface: pass `rotate: true` to turn the screen a quarter turn (it names the shape you get rather than the preset\'s stored form).'
      : ` \`orientation\` was removed from this surface, and this tool has no rotation input of its own${
          elsewhere === '' ? '' : `; the tools that take \`rotate\` are ${elsewhere}`
        }.`
  return (
    `${tool}: unknown input key${keys.length === 1 ? '' : 's'} ${keys.map(k => `\`${k}\``).join(', ')}.` +
    `${removed} This tool takes: ${accepted.join(', ')}. ` +
    `An unknown key is refused rather than ignored, so a call that asks for something this tool cannot do fails ` +
    `instead of returning a screen that is not the one you asked for.`
  )
}

/**
 * Wraps `registerTool` so no tool can forget, the same hook `stampLaneResults`
 * and `rejectUndeclaredKeysUnderTest` use. Order against those two does not
 * matter: this replaces the *schema* in the config and touches no handler, and
 * the SDK parses arguments before any handler wrapper runs.
 */
export function refuseUnknownInputKeys(target: { registerTool: unknown }): void {
  const register = (target.registerTool as Register).bind(target) as Register
  const wrapped: Register = (name, config, handler) => {
    const shape = (config as { inputSchema?: unknown }).inputSchema
    if (!isRawShape(shape)) return register(name, config, handler)
    const tool = String(name)
    const accepted = Object.keys(shape).sort()
    if (accepted.includes('rotate')) rotateTools.add(tool)
    const strict = z.strictObject(shape as Record<string, z.ZodType>, {
      error: issue => (issue.code === 'unrecognized_keys' ? refusal(tool, issue.keys, accepted) : undefined),
    })
    return register(name, { ...(config as Record<string, unknown>), inputSchema: strict }, handler)
  }
  ;(target as { registerTool: unknown }).registerTool = wrapped
}
