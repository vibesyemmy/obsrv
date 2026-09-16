import { test, expect, type ElectronApplication } from '@playwright/test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { request } from 'node:http'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { CONTROL_FILE_NAME, parseControlFile, type ControlInfo } from '../../src/shared/control'
import { launchApp } from './launch'

/**
 * bug-throttle-refusal-stderr-only: when Chromium refuses a throttle, the
 * reply must say so where its reader looks. Nothing outside the process can
 * make Chromium refuse (a second debugger client is allowed to attach), so the
 * refusal is forced through `OBSRV_TEST_THROTTLE_REFUSAL`, which the target
 * honours only under `OBSRV_TEST` — inside `applyThrottle`'s own `try`, so the
 * sentence is the product's, not the test's. Every test here asserts the
 * forced message arrives, which a run under a throttle that works cannot do.
 */

const ROOT = resolve(__dirname, '../..')
const BIN = resolve(ROOT, 'bin/obsrv.js')
const MCP_BIN = resolve(ROOT, 'bin/obsrv-mcp.js')
const FIXTURE = pathToFileURL(resolve(__dirname, '../fixtures/audit.html')).href
const FORCED = 'refused by the harness'
const SENTENCE = `throttle slow-4g not applied: ${FORCED}`

interface CliResult {
  code: number
  stdout: string
  stderr: string
}

function runCli(args: string[], env: Record<string, string>): Promise<CliResult> {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [BIN, ...args], { cwd: ROOT, env: { ...process.env, OBSRV_TEST: '1', ...env } })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', d => (stdout += d))
    child.stderr.on('data', d => (stderr += d))
    child.on('error', fail)
    child.on('close', code => done({ code: code ?? -1, stdout, stderr }))
  })
}

const refusedIn = (lines: unknown): string[] => (Array.isArray(lines) ? lines.filter((l): l is string => typeof l === 'string' && l.includes('not applied')) : [])

test.describe('headless: inspect, audit and lint say a refused throttle in the reply', () => {
  // Each command's own array for sentences about the answer: inspect's
  // `notes`; audit's and lint's `warnings`, which is where their notes go.
  for (const [command, key, extra] of [
    ['inspect', 'notes', ['--selector', '#big']],
    ['audit', 'warnings', []],
    ['lint', 'warnings', []],
  ] as const) {
    test(`${command}`, async () => {
      const args = [command, FIXTURE, '--preset', 'laptop-768', '--throttle', 'slow-4g', ...extra]
      const refused = await runCli(args, { OBSRV_TEST_THROTTLE_REFUSAL: FORCED })
      expect(refused.code, refused.stderr).toBe(0)
      const r = JSON.parse(refused.stdout)
      expect(refusedIn(r[key]), `${key}: ${JSON.stringify(r[key])}`).toEqual([SENTENCE])
      // The field still reports the flag it was given; the note is what says it did not take.
      expect(r.throttle).toBe('slow-4g')
      // Said once on stderr too, not twice.
      expect(refused.stderr.split(SENTENCE).length - 1, refused.stderr).toBe(1)

      // The control: the same call with nothing refused has no such note.
      const applied = await runCli(args, {})
      expect(applied.code, applied.stderr).toBe(0)
      expect(refusedIn(JSON.parse(applied.stdout)[key])).toEqual([])
    })
  }
})

test.describe('live: a refused throttle is not shown as in force, and the reply says why', () => {
  let app: ElectronApplication
  let info: ControlInfo
  let client: Client

  test.beforeAll(async () => {
    app = await launchApp([], { OBSRV_AGENT_CONTROL: '1', OBSRV_TEST_THROTTLE_REFUSAL: FORCED })
    const userData = await app.evaluate(({ app: a }) => a.getPath('userData'))
    const controlFile = join(userData, CONTROL_FILE_NAME)
    await expect.poll(() => existsSync(controlFile)).toBe(true)
    info = parseControlFile(readFileSync(controlFile, 'utf8'))!
    const env = Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined))
    client = new Client({ name: 'throttle-refused-spec', version: '0.0.0' })
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [MCP_BIN], cwd: ROOT, env: { ...env, OBSRV_CONTROL_FILE: controlFile } }))
    // Every reply below is validated against its tool's schema.
    await client.listTools()
  })
  test.afterAll(async () => {
    await client?.close()
    await app?.close()
  })

  const call = (command: string, payload?: Record<string, unknown>): Promise<Record<string, unknown>> =>
    new Promise((done, fail) => {
      const data = JSON.stringify({ command, token: info.token, ...(payload ? { payload } : {}) })
      const req = request({ host: '127.0.0.1', port: info.port, method: 'POST', path: '/', headers: { 'content-type': 'application/json' } }, res => {
        let text = ''
        res.on('data', d => (text += String(d)))
        res.on('end', () => done(JSON.parse(text) as Record<string, unknown>))
      })
      req.on('error', fail)
      req.end(data)
    })
  const targetThrottle = (): Promise<string> => app.evaluate(() => (globalThis as any).__obsrv.target.getThrottle().id as string)

  test('control setThrottle: applied false, the sentence, and the tab keeps the throttle it had', async () => {
    const r = await call('setThrottle', { throttle: 'slow-4g' })
    expect(r).toMatchObject({ ok: true, applied: false, throttle: 'none' })
    expect(r['warnings']).toEqual([SENTENCE])
    expect(await targetThrottle()).toBe('none')
    // Lifting is not refused: nothing is applied, so nothing can be.
    expect(await call('setThrottle', { throttle: 'none' })).toMatchObject({ ok: true, applied: true, throttle: 'none' })
  })

  test('obsrv_drive and a live obsrv_snap carry the sentence in warnings', async () => {
    const drive = (await client.callTool({ name: 'obsrv_drive', arguments: { throttle: 'slow-4g' } })) as CallToolResult
    expect(drive.isError).toBeFalsy()
    expect(drive.structuredContent).toMatchObject({ throttle: 'none' })
    expect(refusedIn((drive.structuredContent as { warnings?: unknown }).warnings)).toEqual([SENTENCE])

    const snap = (await client.callTool({ name: 'obsrv_snap', arguments: { url: FIXTURE, throttle: 'slow-4g' } }, undefined, { timeout: 120_000 })) as CallToolResult
    expect(snap.isError).toBeFalsy()
    expect(snap.structuredContent).toMatchObject({ mode: 'live' })
    expect(refusedIn((snap.structuredContent as { warnings?: unknown }).warnings)).toEqual([SENTENCE])
    expect(await targetThrottle()).toBe('none')
  })
})
