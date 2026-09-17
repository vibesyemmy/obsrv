import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

/**
 * Every headless tool refuses a disagreeing `rotate` and `orientation`, the
 * way obsrv_snap does. The argument builders pass `--rotate` only when it is
 * true, so `rotate: false` never reached the CLI: `orientation: 'landscape',
 * rotate: false` rendered rotated on audit, lint, inspect and report, with no
 * refusal (Wren's release sweep of #178). The refusal happens in the MCP layer,
 * before any render, so this reads the BUILT server the way a client does —
 * like `publicShape.test.ts`.
 *
 * A refusal that regresses must not launch anything either: the call would go
 * on to render. So the server gets a stand-in `electron` package
 * (OBSRV_ELECTRON_PKG_DIR, as mcp-electron.spec uses) whose binary records
 * that it was reached and exits, and the URL is unroutable. A regression fails
 * here in milliseconds, on this machine, with no Electron and no network (Wren's
 * read of #207).
 */
const ROOT = resolve(__dirname, '../..')
const BIN = resolve(ROOT, 'bin/obsrv-mcp.js')

const disagreeing = { url: 'http://127.0.0.1:9/', orientation: 'landscape', rotate: false, timeoutMs: 2_000 }
const calls: [string, Record<string, unknown>][] = [
  ['obsrv_snap', { ...disagreeing, preset: 'laptop-768', mode: 'headless' }],
  ['obsrv_audit', { ...disagreeing, preset: 'laptop-768', mode: 'headless' }],
  ['obsrv_lint', { ...disagreeing, preset: 'laptop-768', mode: 'headless' }],
  ['obsrv_inspect', { ...disagreeing, preset: 'laptop-768', selector: 'h1', mode: 'headless' }],
  ['obsrv_report', { ...disagreeing, presets: ['laptop-768'] }],
]

let stubDir = ''
let reached = ''

beforeAll(() => {
  stubDir = mkdtempSync(join(tmpdir(), 'obsrv-rotate-refused-'))
  reached = join(stubDir, 'reached')
  mkdirSync(join(stubDir, 'dist'))
  writeFileSync(join(stubDir, 'path.txt'), 'stand-in\n')
  const bin = join(stubDir, 'dist', 'stand-in')
  writeFileSync(bin, `#!/bin/sh\necho "$@" >> '${reached}'\nexit 3\n`)
  chmodSync(bin, 0o755)
})

afterAll(() => {
  if (stubDir) rmSync(stubDir, { recursive: true, force: true })
})

describe('a disagreeing rotate and orientation', () => {
  it('is refused by every tool that renders headlessly, before anything renders', async () => {
    expect(existsSync(resolve(ROOT, 'out/mcp/server.js')), 'out/mcp/server.js is missing — run npm run build').toBe(true)
    const client = new Client({ name: 'rotate-refused', version: '0' })
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [BIN],
        cwd: ROOT,
        env: { ...process.env, OBSRV_TEST: '1', OBSRV_ELECTRON_PKG_DIR: stubDir } as Record<string, string>,
        stderr: 'ignore',
      }),
    )
    try {
      const listed = (await client.listTools()).tools.map(t => t.name)
      for (const [name, args] of calls) {
        // Not vacuous: the tool exists, so a missing refusal is a real miss.
        expect(listed, `${name} is not listed`).toContain(name)
        const r = await client.callTool({ name, arguments: args })
        const text = (r.content as { type: string; text?: string }[]).map(c => c.text ?? '').join(' ')
        expect(r.isError, `${name} did not refuse: ${text.slice(0, 200)}`).toBe(true)
        expect(text, `${name} failed, but not with the refusal`).toMatch(/disagree/)
        expect(existsSync(reached), `${name} reached the CLI's Electron before refusing`).toBe(false)
      }
    } finally {
      await client.close()
    }
  }, 60_000)
})
