import { describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * `orientation` is deprecated in favour of `rotate` (bug-orientation-name,
 * decided spec item 2: "its descriptions and --help say it is deprecated and
 * name `rotate`"). `--help` said so; the MCP surface, which is what an agent
 * reads, did not. The field's own description still offered it as the way to
 * rotate, obsrv_snap's description taught `orientation: "landscape"`, and
 * obsrv_presets' note told agents to pass it. Read from the BUILT server the
 * way a client reads it. obsrv_presets renders nothing.
 */
const ROOT = resolve(__dirname, '../..')
const BIN = resolve(ROOT, 'bin/obsrv-mcp.js')

type Schema = { properties?: Record<string, { description?: string }> }

describe('the deprecated orientation', () => {
  it('is marked deprecated wherever a tool takes it, and nothing an agent reads teaches it as the way to rotate', async () => {
    expect(existsSync(resolve(ROOT, 'out/mcp/server.js')), 'out/mcp/server.js is missing — run npm run build').toBe(true)
    const client = new Client({ name: 'rotate-deprecated', version: '0' })
    await client.connect(
      new StdioClientTransport({ command: process.execPath, args: [BIN], cwd: ROOT, env: { ...process.env, OBSRV_TEST: '1' } as Record<string, string>, stderr: 'ignore' }),
    )
    try {
      const tools = (await client.listTools()).tools
      const taking = tools.filter(t => (t.inputSchema as Schema).properties?.['orientation'] !== undefined)
      // Not vacuous: snap, audit, lint, inspect, report and drive take it today.
      expect(taking.map(t => t.name).sort()).toEqual(['obsrv_audit', 'obsrv_drive', 'obsrv_inspect', 'obsrv_lint', 'obsrv_report', 'obsrv_snap'])
      for (const t of taking) {
        const props = (t.inputSchema as Schema).properties!
        expect(props['orientation']!.description ?? '', `${t.name}: orientation`).toMatch(/^DEPRECATED, use `rotate`/)
        expect(props['rotate'], `${t.name} takes orientation but not rotate`).toBeDefined()
      }
      const snap = tools.find(t => t.name === 'obsrv_snap')!
      expect(snap.description, 'obsrv_snap teaches the deprecated field').not.toMatch(/orientation: "landscape"/)
      expect(snap.description).toMatch(/`rotate: true`/)

      const presets = await client.callTool({ name: 'obsrv_presets', arguments: {} })
      const note = String((presets.structuredContent as { orientation?: unknown } | undefined)?.orientation ?? '')
      expect(note, 'obsrv_presets has no orientation note').not.toBe('')
      expect(note).toMatch(/pass rotate: true/)
      expect(note, 'the note teaches the deprecated field').not.toMatch(/pass orientation/)
    } finally {
      await client.close()
    }
  }, 60_000)
})
