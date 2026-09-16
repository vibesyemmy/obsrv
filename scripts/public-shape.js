#!/usr/bin/env node
/**
 * The public shape of the MCP surface: every key path every tool's PUBLISHED
 * output schema declares, read from the server's own `tools/list`.
 *
 * Why this exists (criterion C2, `board/c2.md`). `docs/compatibility.md` states
 * the rule and `docs/breaking-changes.md` keeps the register, but nothing fails
 * when the register is not kept — so it is kept by whoever remembers, which is
 * "by habit". `url` changed meaning for live callers in 0.59.0 and the card
 * records that habit missed it.
 *
 * Why a shape diff is enough HERE, and only here: `docs/compatibility.md` says
 * that on the MCP surface **adding** a field is breaking too, because every
 * output schema is `additionalProperties: false` and a client holding the old
 * schema rejects a reply carrying a field it does not know. So this does not
 * have to judge severity. Any movement in the set is a change that owes the
 * register an entry.
 *
 * **Read from `tools/list`, not from the zod shapes.** "Public" means what a
 * client actually receives. Converting the zod a second time here would give a
 * second definition of "declared" that could drift from the published one —
 * the finding from #127, where the server's own check was rebuilt to read the
 * published schema for exactly this reason.
 *
 * WHAT THIS DOES NOT SEE, and the check is named for what it measures rather
 * than for what C2 wants:
 *
 *   - **a field whose MEANING changes while its shape stays**, which is
 *     `bug-orientation-name` and is the case C2 cares about most. Invisible to
 *     any shape diff, by construction.
 *   - **the CLI's JSON output**, which is its own surface and its own snapshot.
 *     Not covered yet; named here so its absence is not read as coverage.
 *
 * A green from this says THE PUBLISHED MCP SHAPE DID NOT MOVE. It does not say
 * that nothing breaking happened, and anything that reports it must not round
 * it up to that.
 */
const { spawn } = require('node:child_process')
const { existsSync } = require('node:fs')
const { resolve } = require('node:path')

const ROOT = resolve(__dirname, '..')
const MCP_BIN = resolve(ROOT, 'bin/obsrv-mcp.js')

/**
 * Every key path a JSON Schema declares — the walk `src/shared/keyPaths.ts`
 * performs — **plus each enum's values**.
 *
 * The enums are not decoration. `docs/compatibility.md` lists *"a new value in
 * an enum a caller may have cached"* among the things that break, alongside a
 * field appearing or vanishing. A first version of this script walked only key
 * paths, and there are **17 enums** across the published output schemas — so
 * adding a value to `unsettledReason` or `why` would have been breaking and
 * invisible to the check written to catch breaking changes. Found by reading
 * `bug-orientation-name`, which is about a different enum entirely.
 *
 * Values are sorted, so reordering a `z.enum` is not reported as a change: the
 * set is what a caller can receive, and its order is not part of the contract.
 */
function schemaKeyPaths(schema, path = '', out = new Set()) {
  if (schema === null || typeof schema !== 'object') return out
  if (Array.isArray(schema.enum)) out.add(`${path || '(root)'} = [${[...schema.enum].map(String).sort().join('|')}]`)
  for (const branch of ['anyOf', 'oneOf', 'allOf']) {
    if (Array.isArray(schema[branch])) for (const sub of schema[branch]) schemaKeyPaths(sub, path, out)
  }
  if (schema.items !== undefined) schemaKeyPaths(schema.items, `${path}[]`, out)
  if (schema.additionalProperties !== undefined && schema.additionalProperties !== false) out.add(`${path}.*`)
  if (schema.properties !== null && typeof schema.properties === 'object') {
    for (const [k, sub] of Object.entries(schema.properties)) {
      const p = path ? `${path}.${k}` : k
      out.add(p)
      schemaKeyPaths(sub, p, out)
    }
  }
  return out
}

/** Ask the running server for its published tools, over stdio, and hang up. */
function listTools() {
  return new Promise((resolvePromise, rejectPromise) => {
    // Say what is wrong immediately, rather than spending the timeout on it.
    // `bin/obsrv-mcp.js` runs the BUILT server, so without a build this can
    // only ever fail — and it used to fail as "did not answer within 30 s",
    // which names the symptom and hides the cause (Kenya, reading #162).
    if (!existsSync(resolve(ROOT, 'out/mcp/server.js'))) {
      rejectPromise(new Error('out/mcp/server.js is missing — run `npm run build` first; this reads the built server, not the sources'))
      return
    }
    const child = spawn(process.execPath, [MCP_BIN], { cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'] })
    let buf = ''
    let settled = false
    const die = (e) => {
      if (settled) return
      settled = true
      child.kill('SIGKILL')
      rejectPromise(e)
    }
    const timer = setTimeout(() => die(new Error('tools/list did not answer within 30 s')), 30_000)
    child.on('error', die)
    child.stdout.on('data', (d) => {
      buf += d
      for (const line of buf.split('\n')) {
        if (!line.trim().startsWith('{')) continue
        let msg
        try { msg = JSON.parse(line) } catch { continue }
        if (msg.id !== 2 || settled) continue
        settled = true
        clearTimeout(timer)
        child.kill('SIGTERM')
        resolvePromise(msg.result?.tools ?? [])
      }
    })
    const send = (o) => child.stdin.write(`${JSON.stringify(o)}\n`)
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'public-shape', version: '0' } } })
    send({ jsonrpc: '2.0', method: 'notifications/initialized' })
    send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
  })
}

/** The snapshot: tool name → sorted key paths of its published output schema. */
async function publicShape() {
  const tools = await listTools()
  if (tools.length === 0) throw new Error('tools/list returned no tools — the snapshot would be vacuously equal to an empty one')
  const shape = {}
  for (const tool of tools) {
    // A tool that publishes no output schema promises no shape. Recorded as
    // null rather than omitted, so REMOVING a schema is a visible change
    // instead of a quiet absence.
    shape[tool.name] = tool.outputSchema === undefined ? null : [...schemaKeyPaths(tool.outputSchema)].sort()
  }
  return shape
}

module.exports = { publicShape, schemaKeyPaths }

if (require.main === module) {
  publicShape()
    .then((shape) => process.stdout.write(`${JSON.stringify(shape, null, 2)}\n`))
    .catch((e) => {
      process.stderr.write(`public-shape: ${e.message}\n`)
      process.exit(1)
    })
}
