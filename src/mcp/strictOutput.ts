import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { emittedKeyPaths, schemaKeyPaths, undeclaredKeyPaths } from '../shared/keyPaths'

/**
 * Under test, every tool checks its own reply against its own output schema
 * and fails the call when it carries a key the schema does not declare.
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
 * (#81), and fenced twice: the fence above *and* this variable. Without it the
 * check is green on a clean tree and nobody ever learns whether it is running
 * — which is precisely what `ci.yml`'s trace upload did for a week while it
 * uploaded an empty directory and passed.
 *
 * The value names the tool to poison, so one call in the suite is poisoned and
 * the rest of the run is ordinary.
 */
const poisonFor = (tool: string): boolean => underTest() && process.env.OBSRV_TEST_UNDECLARED_KEY === tool

type Register = (name: unknown, config: unknown, handler: unknown) => unknown
type ListHandler = (request: unknown, extra: unknown) => Promise<{ tools?: { name?: unknown; outputSchema?: unknown }[] }>

/**
 * The declared paths of every tool, read from **the server's own `tools/list`
 * reply** — the exact object a client caches and validates against.
 *
 * Deriving them from the zod shapes instead would mean a second conversion
 * with its own options, and this check's error message appeals to what a
 * validating client does with the reply. If the two conversions ever disagreed,
 * this would fail a reply that every client accepts, or pass one they reject —
 * and the sentence naming `-32602` would be the confident wrong answer. There
 * is one definition of "declared" here, and it belongs to the client.
 *
 * Read once, lazily: the list handler exists only after the first tool is
 * registered, and every tool is registered before any call arrives.
 */
async function publishedPaths(server: unknown, warn: (line: string) => void): Promise<Map<string, Set<string>> | null> {
  const low = (server as { server?: { _requestHandlers?: Map<string, ListHandler> } }).server
  const handler = low?._requestHandlers?.get('tools/list')
  if (handler === undefined) {
    warn('obsrv: strict output check DISABLED — the server exposes no tools/list handler to read its published schemas from')
    return null
  }
  try {
    const listed = await handler({ method: 'tools/list', params: {} }, { signal: new AbortController().signal })
    const out = new Map<string, Set<string>>()
    for (const tool of listed.tools ?? []) {
      // A tool that publishes no output schema promises no shape, so nothing
      // it emits is undeclared. Absent from the map, not empty in it — an
      // empty set would call every key it sends a violation.
      if (typeof tool.name === 'string' && tool.outputSchema !== undefined) out.set(tool.name, schemaKeyPaths(tool.outputSchema))
    }
    return out
  } catch (e) {
    warn(`obsrv: strict output check DISABLED — reading the published schemas failed: ${e instanceof Error ? e.message : String(e)}`)
    return null
  }
}

/**
 * Wraps `registerTool` so no tool can forget the check — the same hook
 * `stampLaneResults` uses, and for the same reason.
 *
 * **Install this BEFORE any other registration wrapper.** Wrappers nest in
 * reverse: the one installed first has its handler wrapper applied last, so it
 * sees the reply as the later wrappers leave it. Installed after
 * `stampLaneResults`, this checked the reply *before* the dev-lane stamp was
 * added, which is not the reply that is sent — and the stamped field is
 * exactly the kind of addition this is meant to catch.
 */
export function rejectUndeclaredKeysUnderTest(
  target: { registerTool: unknown },
  warn: (line: string) => void = line => process.stderr.write(`${line}\n`),
): void {
  const register = (target.registerTool as Register).bind(target) as Register
  let paths: Promise<Map<string, Set<string>> | null> | null = null
  const wrapped: Register = (name, config, handler) => {
    const tool = String(name)
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
      paths ??= publishedPaths(target, warn)
      const declared = (await paths)?.get(tool)
      if (declared === undefined) return out
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
