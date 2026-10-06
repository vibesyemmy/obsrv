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
 */

const SERVER = resolve(__dirname, '../../out/mcp/server.js')

async function listTools(): Promise<Array<{ name: string; description?: string; inputSchema: unknown; outputSchema?: unknown }>> {
  const client = new Client({ name: 'rotate-only-way', version: '0' }, { capabilities: {} })
  const transport = new StdioClientTransport({ command: process.execPath, args: [SERVER], env: { ...process.env, OBSRV_TEST: '1' } })
  await client.connect(transport)
  try {
    return (await client.listTools()).tools as never
  } finally {
    await client.close()
  }
}

const words = (o: unknown): string => JSON.stringify(o ?? {})

describe('rotate is the only way to turn a screen', () => {
  it('builds before it can be read', () => {
    // A missing build would make every assertion below vacuous rather than red.
    expect(existsSync(SERVER), `${SERVER} is missing — run npm run build`).toBe(true)
  })

  it('no tool takes an `orientation` input, and none teaches the word', async () => {
    const tools = await listTools()
    expect(tools.length).toBeGreaterThan(5)
    for (const tool of tools) {
      const schema = words(tool.inputSchema)
      expect(JSON.parse(schema).properties?.orientation, `${tool.name} still takes orientation`).toBeUndefined()
      // The description is what an agent reads; a removed field that is still
      // named in prose teaches a flag that now errors.
      expect(`${tool.name}: ${tool.description ?? ''}`).not.toMatch(/orientation/i)
    }
  })

  it('no tool returns an `orientation` field', async () => {
    const tools = await listTools()
    for (const tool of tools) {
      const out = tool.outputSchema === undefined ? {} : (JSON.parse(words(tool.outputSchema)) as { properties?: Record<string, unknown> })
      expect(out.properties?.orientation, `${tool.name} still returns orientation`).toBeUndefined()
    }
  })

  it('`rotate` is still offered, so the removal did not take the replacement with it', async () => {
    const tools = await listTools()
    const takesRotate = tools.filter(t => JSON.parse(words(t.inputSchema)).properties?.rotate !== undefined)
    // A count, not a boolean: if this drops to zero the surface has no way to
    // rotate at all, which is a worse outcome than the one being fixed.
    expect(takesRotate.length).toBeGreaterThan(3)
  })
})
