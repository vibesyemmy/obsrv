import { describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * `rotate` is the only way to turn a screen, and `orientation` is gone from the
 * published MCP surface (`docs/breaking-changes.md`, the breaking release).
 *
 * **This file replaces two that are now meaningless:** `rotateDeprecated.test.ts`
 * checked that the word was *marked* deprecated wherever a tool took it, and
 * `rotateRefused.test.ts` checked that a `rotate`/`orientation` pair which
 * disagreed was refused. Neither can fail any more — there is no second way to
 * ask, so there is nothing to mark and nothing to disagree with. **Deleting
 * them without replacement would have removed the only check that the removal
 * actually reached the surface**, which is the thing a re-introduction would
 * break.
 *
 * Read from the BUILT server the way a client reads it, for the reason the
 * shape check is: "public" means what a client receives, and converting the zod
 * a second time here would check this file against itself.
 *
 * **The first version of this file checked `tool.description` and top-level
 * `properties` only, and Idris measured it: 4 of 6 mutants caught, with the
 * word in a *property* description and a *nested* `orientation` output key both
 * surviving** (room #4022). That is the difference between the claim ("none
 * teaches the word") and the heuristic that was actually running. The walk
 * below is the claim: every string and every key, at any depth, in the name,
 * the description and both schemas.
 */

const SERVER = resolve(__dirname, '../../out/mcp/server.js')

type Tool = { name: string; description?: string; inputSchema?: unknown; outputSchema?: unknown }

async function withClient<T>(use: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ name: 'rotate-only-way', version: '0' }, { capabilities: {} })
  const transport = new StdioClientTransport({ command: process.execPath, args: [SERVER], env: { ...process.env, OBSRV_TEST: '1' } })
  await client.connect(transport)
  try {
    return await use(client)
  } finally {
    await client.close()
  }
}

const listTools = (): Promise<Tool[]> => withClient(async c => (await c.listTools()).tools as never)

const WORD = /orientation/i

/**
 * Every place the word appears in what a client receives, named by path so a
 * failure says *where* rather than only *that*. Keys as well as values: a
 * nested `orientation` property is a re-introduction even if no prose mentions
 * it, and that was one of the two mutants the shallow version let through.
 */
function wordHits(value: unknown, path: string, out: string[] = []): string[] {
  if (typeof value === 'string') {
    if (WORD.test(value)) out.push(`${path} = ${JSON.stringify(value.length > 90 ? `${value.slice(0, 90)}…` : value)}`)
    return out
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => wordHits(v, `${path}[${i}]`, out))
    return out
  }
  if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (WORD.test(k)) out.push(`${path}.${k} (key)`)
      wordHits(v, `${path}.${k}`, out)
    }
  }
  return out
}

/** The same walk, keys only — the claim about the shape rather than the prose. */
function keyHits(value: unknown, path: string, out: string[] = []): string[] {
  if (Array.isArray(value)) {
    value.forEach((v, i) => keyHits(v, `${path}[${i}]`, out))
    return out
  }
  if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (WORD.test(k)) out.push(`${path}.${k}`)
      keyHits(v, `${path}.${k}`, out)
    }
  }
  return out
}

describe('rotate is the only way to turn a screen', () => {
  it('builds before it can be read', () => {
    // A missing build would make every assertion below vacuous rather than red.
    expect(existsSync(SERVER), `${SERVER} is missing — run npm run build`).toBe(true)
  })

  it('the word appears nowhere a client can read it, at any depth', async () => {
    const tools = await listTools()
    expect(tools.length).toBeGreaterThan(5)
    const hits: string[] = []
    for (const tool of tools) {
      wordHits({ name: tool.name, description: tool.description ?? '', inputSchema: tool.inputSchema ?? {}, outputSchema: tool.outputSchema ?? {} }, tool.name, hits)
    }
    // Measured at the head this was written against: 9 tools, 0 hits. The
    // control for the walk is Idris's: mutating one property description to
    // name the word reports 6 hits, one per tool that takes `rotate`.
    expect(hits, `the removed word is still published:\n${hits.join('\n')}`).toEqual([])
  })

  it('no tool takes or returns an `orientation` key, at any depth', async () => {
    const tools = await listTools()
    const keys: string[] = []
    for (const tool of tools) {
      keyHits(tool.inputSchema ?? {}, `${tool.name}.input`, keys)
      keyHits(tool.outputSchema ?? {}, `${tool.name}.output`, keys)
    }
    // Kept separate from the prose check above on purpose: if a description
    // ever has a legitimate reason to say the word, this is the assertion that
    // must still hold, and it should not be loosened along with that one.
    expect(keys, `an orientation key is back in the surface:\n${keys.join('\n')}`).toEqual([])
  })

  it('`rotate` is still offered, so the removal did not take the replacement with it', async () => {
    const tools = await listTools()
    const takesRotate = tools.filter(t => (t.inputSchema as { properties?: Record<string, unknown> })?.properties?.rotate !== undefined)
    // A count, not a boolean: if this drops to zero the surface has no way to
    // rotate at all, which is a worse outcome than the one being fixed. Six at
    // the head this was written against (snap, audit, lint, report, drive,
    // inspect).
    expect(takesRotate.length).toBeGreaterThan(3)
  })

  it('a leftover `orientation` key is refused rather than dropped, and the refusal names `rotate`', async () => {
    // The class-1 case this release's input strictness exists for
    // (`src/mcp/strictInput.ts`): zod drops an unknown key, so without it a
    // caller still sending the old word gets an unrotated screen with
    // `isError: false` and `warnings: []`. Checked here on `obsrv_presets`,
    // which touches nothing, and on a `rotate`-taking tool; `mcp.spec.ts` has
    // the same case end to end against a real render.
    // **Measured, not assumed: the SDK does not throw on an input-validation
    // failure.** It resolves with `isError: true`, no `structuredContent`, and
    // the message in `content` — so a test written around a rejection would
    // pass on a server that accepted the key and returned any error at all.
    // This reads the sentence.
    const tools = await listTools()
    const refusals = await withClient(async c => {
      const out: Record<string, string> = {}
      for (const [name, args] of [
        ['obsrv_presets', { orientation: 'landscape' }],
        ['obsrv_snap', { url: 'file:///does-not-exist.html', orientation: 'landscape' }],
      ] as const) {
        const r = await c
          .callTool({ name, arguments: args })
          .then(v => v, (e: unknown) => ({ isError: true, content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }] }))
        const said = ((r.content ?? []) as { text?: string }[]).map(b => b.text ?? '').join(' ')
        out[name] = r.isError === true ? said : `NOT REFUSED: ${said.slice(0, 200)}`
      }
      return out
    })
    for (const [tool, said] of Object.entries(refusals)) {
      expect(said, `${tool} did not refuse the removed key`).toContain('unknown input key `orientation`')
    }
    // **The two tools are not interchangeable here, and the first version of
    // this test treated them as if they were.** `obsrv_snap` takes `rotate`, so
    // its refusal says to pass it. `obsrv_presets` does NOT — and told to "pass
    // `rotate: true`" a caller earns a second refusal, `unknown input key
    // ``rotate```. Wren found that on the pushed head (room #4041), so the
    // assertion is per tool: promise the flag only where it exists, and point
    // at the tools that have it where it does not.
    expect(refusals.obsrv_snap, 'snap takes rotate, so its refusal should say to pass it').toContain('rotate: true')
    expect(refusals.obsrv_presets, 'presets cannot rotate, so it must not promise rotate').not.toContain('pass `rotate: true`')
    // **The named list must EQUAL the tools that publish `rotate`, not merely
    // contain one of them.** `toMatch(/… are .*obsrv_snap/)` passed on two
    // wrong lists that Idris and Wren each built as mutants (#4047, #4048): a
    // set filled for every tool names all nine including the non-rotating ones,
    // and a set frozen at registration names only the takers registered so far
    // — `obsrv_diff` would have said "obsrv_snap." alone. Both satisfy a
    // substring and neither is the sentence a caller can act on.
    const takers = tools
      .filter(t => (t.inputSchema as { properties?: Record<string, unknown> })?.properties?.rotate !== undefined)
      .map(t => t.name)
      .sort()
    expect(takers.length, 'no tool publishes rotate — the list below would be vacuous').toBeGreaterThan(3)
    const named = /tools that take `rotate` are ([^.]+)\./.exec(refusals.obsrv_presets ?? '')?.[1] ?? ''
    expect(
      named.split(', ').map(s => s.trim()).sort(),
      `presets named "${named}" but the tools that publish rotate are ${takers.join(', ')}`,
    ).toEqual(takers)
  })

  it('every tool publishes an input schema that refuses unknown keys', async () => {
    const tools = await listTools()
    const loose = tools.filter(t => (t.inputSchema as { additionalProperties?: unknown })?.additionalProperties !== false).map(t => t.name)
    // The published half of the same fact: a client reading the schema is told
    // the key would be refused, rather than finding out by being refused.
    expect(loose, `tools whose published inputSchema still admits unknown keys: ${loose.join(', ')}`).toEqual([])
  })
})
