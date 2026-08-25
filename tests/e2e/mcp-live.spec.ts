import { test, expect, type ElectronApplication } from '@playwright/test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { CONTROL_FILE_NAME } from '../../src/shared/control'
import { launchApp } from './launch'

/**
 * The MCP server against a *running*, control-enabled app: `obsrv_snap`
 * auto-discovers it and goes live, `obsrv_drive` flips visible state. The
 * server is pointed at the test app's isolated user-data dir through
 * OBSRV_CONTROL_FILE, so a real Obsrv the developer has open is never
 * touched (and can never hijack the test).
 */

const ROOT = resolve(__dirname, '../..')
const MCP_BIN = resolve(ROOT, 'bin/obsrv-mcp.js')
const FIXTURE = pathToFileURL(resolve(__dirname, '../fixtures/hairline.html')).href

// A headless-override render boots a full Electron; same budgets as mcp.spec.
const CALL_TIMEOUT_MS = 150_000
test.describe.configure({ timeout: 180_000 })

let app: ElectronApplication
let client: Client

test.beforeAll(async () => {
  app = await launchApp([], { OBSRV_AGENT_CONTROL: '1' })
  const userData = await app.evaluate(({ app: a }) => a.getPath('userData'))
  const env = Object.fromEntries(
    Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined),
  )
  client = new Client({ name: 'obsrv-mcp-live-spec', version: '0.0.0' })
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [MCP_BIN],
      cwd: ROOT,
      env: { ...env, OBSRV_CONTROL_FILE: join(userData, CONTROL_FILE_NAME) },
    }),
  )
})

test.afterAll(async () => {
  await client?.close()
  await app?.close()
})

const call = (name: string, args: Record<string, unknown>): Promise<CallToolResult> =>
  client.callTool({ name, arguments: args }, undefined, { timeout: CALL_TIMEOUT_MS }) as Promise<CallToolResult>

test('obsrv_snap (auto) drives the visible app and captures its window', async () => {
  const r = await call('obsrv_snap', { url: FIXTURE, preset: 'laptop-768' })
  expect(r.isError).toBeFalsy()

  const meta = r.structuredContent as Record<string, unknown>
  expect(meta).toMatchObject({
    mode: 'live',
    url: FIXTURE,
    presetId: 'laptop-768',
    profileId: 'reference',
    settled: true,
  })
  expect(meta.width as number).toBeGreaterThanOrEqual(900)
  expect(meta.height as number).toBeGreaterThanOrEqual(600)

  // The PNG on disk is the app window (not a headless render).
  expect(existsSync(meta.pngPath as string)).toBe(true)
  const png = readFileSync(meta.pngPath as string)
  expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

  // The app really navigated and resized — visible state, not a simulation.
  expect(await app.evaluate(() => (globalThis as any).__obsrv.target.webContents.getURL())).toBe(FIXTURE)
  expect(await app.evaluate(() => (globalThis as any).__obsrv.target.getViewport())).toEqual({ width: 1366, height: 768 })
})

test('obsrv_drive flips the preset and returns the confirming status', async () => {
  const r = await call('obsrv_drive', { preset: '1080p-27', profile: 'budget-tn' })
  expect(r.isError).toBeFalsy()
  expect(r.structuredContent).toMatchObject({ presetId: '1080p-27', profileId: 'budget-tn', mode: 'url' })
  await expect
    .poll(() => app.evaluate(() => (globalThis as any).__obsrv.target.getViewport()))
    .toEqual({ width: 1920, height: 1080 })
})

test('obsrv_snap mode:"headless" ignores the running app', async () => {
  const r = await call('obsrv_snap', { url: FIXTURE, preset: 'laptop-768', mode: 'headless' })
  expect(r.isError).toBeFalsy()
  const meta = r.structuredContent as Record<string, unknown>
  // A headless render of the page, not a window capture: CLI metadata shape.
  expect(meta).toMatchObject({ mode: 'headless', preset: 'laptop-768', cssWidth: 1366, cssHeight: 768 })
})
