import { test, expect } from '@playwright/test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, statSync, utimesSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * The dev lane end to end: a session's obsrv-dev proxy, pointed at this
 * checkout, launches this checkout's own app build on the lane's profile —
 * beside an installed Obsrv, never instead of it — and relaunches it when a
 * newer build exists, so what was just built is what the next live call
 * drives. Uses a throwaway lane home, so a developer's own lane is untouched.
 */
const ROOT = resolve(__dirname, '../..')
const ENTRY = join(ROOT, 'out', 'main', 'index.js')
const fixture = (name: string): string => pathToFileURL(resolve(__dirname, `../fixtures/${name}`)).href
const lane = createRequire(__filename)('../../scripts/devLane.js') as { pointLaneAt(root: string, env?: NodeJS.ProcessEnv): void }

test.describe.configure({ timeout: 120_000 })

let home: string
let client: Client
let entryMtime: Date

const appPid = (): number | null => {
  try {
    return (JSON.parse(readFileSync(join(home, 'profile', 'control.json'), 'utf8')) as { pid?: number }).pid ?? null
  } catch {
    return null
  }
}
const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
const call = (name: string, args: Record<string, unknown>): Promise<CallToolResult> =>
  client.callTool({ name, arguments: args }, undefined, { timeout: 100_000 }) as Promise<CallToolResult>
const said = (r: CallToolResult): string => {
  const s = r.structuredContent as { notes?: string[]; warnings?: string[] }
  return [...(s.notes ?? []), ...(s.warnings ?? [])].join(' ')
}

test.beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), 'obsrv-dev-lane-e2e-'))
  lane.pointLaneAt(ROOT, { OBSRV_DEV_HOME: home })
  entryMtime = statSync(ENTRY).mtime
  // Not OBSRV_TEST: the point is a real launch, on a throwaway profile.
  const env = Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined && e[0] !== 'OBSRV_TEST'))
  client = new Client({ name: 'obsrv-dev-lane-spec', version: '0.0.0' })
  await client.connect(
    new StdioClientTransport({ command: process.execPath, args: [join(ROOT, 'scripts', 'dev-mcp.js')], cwd: ROOT, env: { ...env, OBSRV_DEV_HOME: home } }),
  )
})

test.afterAll(async () => {
  await client?.close()
  const pid = appPid()
  if (pid !== null && alive(pid)) {
    process.kill(pid, 'SIGTERM')
    for (let i = 0; i < 50 && alive(pid); i++) await new Promise(r => setTimeout(r, 100))
    if (alive(pid)) process.kill(pid, 'SIGKILL')
  }
  utimesSync(ENTRY, entryMtime, entryMtime)
  rmSync(home, { recursive: true, force: true })
})

test("the lane launches this checkout's own app on the lane's profile, beside the installed one", async () => {
  const r = await call('obsrv_audit', { url: fixture('audit.html'), mode: 'live', groupsOnly: true })
  expect(r.isError, JSON.stringify(r.content).slice(0, 400)).toBeFalsy()
  expect(r.structuredContent).toMatchObject({ mode: 'live', launched: true })
  const pid = appPid()
  expect(pid).not.toBeNull()
  const args = execFileSync('ps', ['-o', 'args=', '-p', String(pid)], { encoding: 'utf8' })
  expect(args).toContain(ENTRY)
  expect(args).toContain(`--user-data-dir=${join(home, 'profile')}`)
})

test('a build newer than the running dev app relaunches it on the next live call, and the answer says so', async () => {
  const before = appPid()
  expect(before).not.toBeNull()
  const now = new Date()
  utimesSync(ENTRY, now, now)
  const r = await call('obsrv_audit', { url: fixture('audit.html'), mode: 'live', groupsOnly: true })
  expect(r.isError, JSON.stringify(r.content).slice(0, 400)).toBeFalsy()
  expect(said(r)).toMatch(/the dev app was relaunched to run the lane's current build/)
  expect(appPid()).not.toBe(before)
  expect(alive(before!)).toBe(false)
})
