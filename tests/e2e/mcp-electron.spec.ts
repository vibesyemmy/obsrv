import { test, expect } from '@playwright/test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * The first headless call after a fresh install used to download Electron
 * (~120 MB) inside the CLI, and the server's kill cut it on a slow link —
 * every call after that started the download again. Now the server fetches a
 * missing Electron at startup, in the background, and a call that arrives
 * during the download waits for it, outside the kill budget, and says so.
 *
 * Measured against a stand-in `electron` package (OBSRV_ELECTRON_PKG_DIR)
 * whose installer takes 1.5 s and then points at the real binary, so nothing
 * is downloaded and the CLI still runs.
 */

const ROOT = resolve(__dirname, '../..')
const MCP_BIN = resolve(ROOT, 'bin/obsrv-mcp.js')
const fixture = (name: string): string => pathToFileURL(resolve(__dirname, `../fixtures/${name}`)).href

test.describe.configure({ timeout: 120_000 })

let client: Client
let stubDir: string

test.beforeAll(async () => {
  const real = resolve(ROOT, 'node_modules/electron')
  const realRelative = readFileSync(join(real, 'path.txt'), 'utf8').trim()
  stubDir = mkdtempSync(join(tmpdir(), 'obsrv-electron-e2e-'))
  writeFileSync(join(stubDir, 'package.json'), JSON.stringify({ name: 'electron', version: '9.9.9' }))
  writeFileSync(
    join(stubDir, 'install.js'),
    `const fs = require('fs'), path = require('path')
process.stdout.write('Downloading electron-v9.9.9\\n')
setTimeout(() => {
  fs.symlinkSync(${JSON.stringify(join(real, 'dist'))}, path.join(__dirname, 'dist'))
  fs.writeFileSync(path.join(__dirname, 'path.txt'), ${JSON.stringify(realRelative + '\n')})
}, 1500)
`,
  )
  client = new Client({ name: 'obsrv-mcp-electron-spec', version: '0.0.0' })
  const env = Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined))
  const started = Date.now()
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [MCP_BIN],
      cwd: ROOT,
      env: { ...env, OBSRV_TEST: '1', OBSRV_CONTROL_FILE: resolve(ROOT, 'tests/fixtures/no-such-control.json'), OBSRV_ELECTRON_PKG_DIR: stubDir },
    }),
  )
  // The server is up before the download is done: the connection must not wait on it.
  expect(Date.now() - started).toBeLessThan(1_400)
})

test.afterAll(async () => {
  await client?.close()
  rmSync(stubDir, { recursive: true, force: true })
})

const call = (name: string, args: Record<string, unknown>): Promise<CallToolResult> =>
  client.callTool({ name, arguments: args }, undefined, { timeout: 100_000 }) as Promise<CallToolResult>

test('a call during the download waits for it and says so; the next call does not', async () => {
  const first = await call('obsrv_audit', { url: fixture('audit.html'), preset: '1080p-24', mode: 'headless', groupsOnly: true })
  expect(first.isError, JSON.stringify(first.content).slice(0, 400)).toBeFalsy()
  const a = first.structuredContent as { notes: string[]; summary: { targets: { count: number } } }
  expect(a.summary.targets.count).toBeGreaterThan(0)
  expect(a.notes.join(' ')).toMatch(/this call waited [\d.]+ s for Electron 9\.9\.9 to download: the first headless call after an install does that once/)

  const second = await call('obsrv_audit', { url: fixture('audit.html'), preset: '1080p-24', mode: 'headless', groupsOnly: true })
  expect(second.isError).toBeFalsy()
  const b = second.structuredContent as { notes: string[] }
  expect(b.notes.join(' ')).not.toMatch(/Electron 9\.9\.9/)
})
