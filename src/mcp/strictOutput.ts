import { z } from 'zod'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { emittedKeyPaths, schemaKeyPaths, undeclaredKeyPaths } from '../shared/keyPaths'

/**
 * Under `OBSRV_TEST=1`, every tool checks its own reply against its own output
 * schema and fails the call when it carries a key the schema does not declare.
 *
 * **Why the server does not catch this on its own**, measured rather than
 * assumed: the SDK parses the reply against the zod output shape and throws
 * away the parsed value (`server/mcp.js:203-210`), sending the original object.
 * Our shapes are plain `z.object`s, and **zod strips unknown keys instead of
 * failing**, so the parse always succeeds and the extra key travels anyway.
 * The JSON Schema the server publishes says `additionalProperties: false`, so
 * the rejection is always the *client's* — and only for a client that cached
 * the schema through `listTools()`.
 *
 * **That is the gap this closes.** Client-side validation switches off exactly
 * when it is most needed: a failing test replaces the Playwright worker, the
 * replacement client has listed nothing, and every test after it runs
 * unvalidated — so CI could only ever report the *first* violation in a file
 * (Rook, room #157). This check is the server's own and depends on no client,
 * so it holds in the runs where the client's is off.
 *
 * **Not in production**, and that is Henry's reasoning: strict for real users
 * would turn a key that slips through into an error for every client,
 * including the many that do not validate today and work fine. A user's client
 * receiving an undeclared field is harmless. A test suite that cannot see one
 * is not.
 *
 * **It compares key paths rather than making the shapes strict.** A top-level
 * `.strict()` would have caught none of the three instances it was written
 * for: `colorPainted` sits inside `readout`, and `obsrv_drive`'s three keys
 * inside a spread status. The paths are nested and so is the comparison.
 */

/**
 * The fence. Read at call time, so a test can set it per spawn.
 *
 * Two variables, and the second is not a convenience. `OBSRV_TEST=1` refuses
 * to launch the app (`launch.ts:95`), so **the specs that drive the live
 * surface cannot set it** — and the live surface is `obsrv_drive` and live
 * `obsrv_snap`, which is where two of the three undeclared keys this check was
 * written for actually lived, and the one surface `schema-emit-sweep.js` skips
 * by design. Fenced on `OBSRV_TEST` alone, this check would have covered
 * everything except the place it was needed most, while reading as though it
 * covered everything. Measured, not reasoned: with the fence on `OBSRV_TEST`
 * alone, `mcp-live.spec` ran 16 `obsrv_drive` tests with a deliberate
 * undeclared key injected and **all 16 passed**.
 */
const underTest = (): boolean => process.env.OBSRV_TEST === '1' || process.env.OBSRV_STRICT_OUTPUT === '1'

/**
 * A deliberate undeclared key, so the suite can prove this check runs.
 *
 * A product change made for a test, on the precedent of
 * `OBSRV_TEST_FIRST_VIEWPORT_DELAY_MS` (#59) and `OBSRV_TEST_THROTTLE_REFUSAL`
 * (#81), and fenced twice: `OBSRV_TEST=1` *and* this variable. Without it the
 * check is green on a clean tree and nobody ever learns whether it is running
 * — which is precisely what `ci.yml`'s trace upload did for a week while it
 * uploaded an empty directory and passed.
 *
 * The value names the tool to poison, so one call in the suite is poisoned and
 * the rest of the run is ordinary.
 */
const poisonFor = (tool: string): boolean => underTest() && process.env.OBSRV_TEST_UNDECLARED_KEY === tool

type Register = (name: unknown, config: unknown, handler: unknown) => unknown

/**
 * The declared key paths of one tool's output schema, or null when the schema
 * cannot be converted. Null disables the check **for that tool**, and the
 * caller says so on stderr rather than passing quietly: a check that silently
 * covers seven tools while reporting eight is the overclaim this repo has
 * already made once (`schema-emit-sweep`'s summary, room #148).
 */
function declaredPathsOf(outputSchema: unknown): Set<string> | null {
  if (outputSchema === null || typeof outputSchema !== 'object') return null
  try {
    const json = z.toJSONSchema(z.object(outputSchema as z.ZodRawShape), { io: 'output', unrepresentable: 'any' })
    return schemaKeyPaths(json)
  } catch {
    return null
  }
}

/**
 * Wraps `registerTool` so no tool can forget the check — the same hook
 * `stampLaneResults` uses, and for the same reason. Call before any tool is
 * registered.
 */
export function rejectUndeclaredKeysUnderTest(target: { registerTool: unknown }, warn: (line: string) => void = line => process.stderr.write(`${line}\n`)): void {
  const register = (target.registerTool as Register).bind(target) as Register
  const wrapped: Register = (name, config, handler) => {
    const tool = String(name)
    const schema = (config as { outputSchema?: unknown }).outputSchema
    // A tool with no output schema declares nothing, so there is nothing to
    // disagree with. Not a gap: the key it emits is not undeclared, because
    // the tool never promised a shape.
    if (schema === undefined) return register(name, config, handler)
    const declared = declaredPathsOf(schema)
    if (declared === null) {
      warn(`obsrv: strict output check DISABLED for ${tool} — its output schema could not be converted`)
      return register(name, config, handler)
    }
    const inner = handler as (...args: unknown[]) => Promise<CallToolResult>
    return register(name, config, async (...args: unknown[]) => {
      const result = await inner(...args)
      if (!underTest()) return result
      const poisoned = poisonFor(tool) ? { ...(result.structuredContent ?? {}), obsrvTestUndeclaredKey: true } : result.structuredContent
      const out = poisoned === result.structuredContent ? result : { ...result, structuredContent: poisoned }
      // An error reply carries no structured content and is not validated by
      // the SDK either, so there is nothing to compare; skipped rather than
      // read as an empty reply, which would call every refusal a violation.
      if (out.isError === true || out.structuredContent === undefined) return out
      const undeclared = undeclaredKeyPaths(emittedKeyPaths(out.structuredContent), declared)
      if (undeclared.length === 0) return out
      throw new Error(
        `${tool} emitted ${undeclared.length} key${undeclared.length === 1 ? '' : 's'} its own output schema does not declare: ` +
          `${undeclared.join(', ')}. The published schema is additionalProperties: false, so a client that validates ` +
          `rejects this reply with -32602 — declare the key in the tool's output shape, or stop sending it. ` +
          `(This check runs only under OBSRV_TEST=1 or OBSRV_STRICT_OUTPUT=1; users are unaffected either way.)`,
      )
    })
  }
  ;(target as { registerTool: unknown }).registerTool = wrapped
}
