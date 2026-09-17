import { describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Every headless tool refuses a disagreeing `rotate` and `orientation`, the
 * way obsrv_snap does. The argument builders pass `--rotate` only when it is
 * true, so `rotate: false` never reached the CLI: `orientation: 'landscape',
 * rotate: false` rendered rotated on audit, lint, inspect and report, with no
 * refusal (Wren's release sweep of #178). The refusal happens in the MCP layer,
 * before any render, so this reads the BUILT server the way a client does —
 * like `publicShape.test.ts` — and launches nothing.
 */
const ROOT = resolve(__dirname, '../..')
const BIN = resolve(ROOT, 'bin/obsrv-mcp.js')

const disagreeing = { url: 'https://example.com', orientation: 'landscape', rotate: false, mode: 'headless' }
const calls: [string, Record<string, unknown>][] = [
  ['obsrv_snap', { ...disagreeing, preset: 'laptop-768' }],
  ['obsrv_audit', { ...disagreeing, preset: 'laptop-768' }],
  ['obsrv_lint', { ...disagreeing, preset: 'laptop-768' }],
  ['obsrv_inspect', { ...disagreeing, preset: 'laptop-768', selector: 'h1' }],
  ['obsrv_report', { url: 'https://example.com', orientation: 'landscape', rotate: false, matrix: ['laptop-768'] }],
]

describe('a disagreeing rotate and orientation', () => {
  it('is refused by every tool that renders headlessly, before anything renders', async () => {
    expect(existsSync(resolve(ROOT, 'out/mcp/server.js')), 'out/mcp/server.js is missing — run npm run build').toBe(true)
    const client = new Client({ name: 'rotate-refused', version: '0' })
    await client.connect(
      new StdioClientTransport({ command: process.execPath, args: [BIN], cwd: ROOT, env: { ...process.env, OBSRV_TEST: '1' } as Record<string, string>, stderr: 'ignore' }),
    )
    try {
      const listed = (await client.listTools()).tools.map(t => t.name)
      const answers: string[] = []
      for (const [name, args] of calls) {
        // Not vacuous: the tool exists, so a missing refusal is a real miss.
        expect(listed, `${name} is not listed`).toContain(name)
        const r = await client.callTool({ name, arguments: args })
        const text = (r.content as { type: string; text?: string }[]).map(c => c.text ?? '').join(' ')
        answers.push(`${name}: isError=${r.isError === true} ${text.slice(0, 120)}`)
        expect(r.isError, `${name} did not refuse: ${text.slice(0, 200)}`).toBe(true)
        expect(text, name).toMatch(/disagree/)
      }
    } finally {
      await client.close()
    }
  }, 60_000)
})
