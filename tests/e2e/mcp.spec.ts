import { test, expect } from '@playwright/test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * Drives the real MCP server: the SDK client spawns `node bin/obsrv-mcp.js`
 * (the built out/mcp/server.js) and speaks JSON-RPC over stdio, the way
 * Claude Code would after `claude mcp add`. Snap/diff boot a full Electron
 * per call, so those tests carry CLI-sized budgets.
 */

const ROOT = resolve(__dirname, '../..')
const MCP_BIN = resolve(ROOT, 'bin/obsrv-mcp.js')
const fixture = (name: string): string => pathToFileURL(resolve(__dirname, `../fixtures/${name}`)).href

// Long enough for two Electron boots (diff) on a loaded machine.
const CALL_TIMEOUT_MS = 150_000
test.describe.configure({ timeout: 180_000 })

let client: Client

test.beforeAll(async () => {
  client = new Client({ name: 'obsrv-mcp-spec', version: '0.0.0' })
  // Point discovery at a file that cannot exist: these are the *no running
  // app* tests, and they must stay headless even when the developer has a
  // control-enabled Obsrv open (see mcp-live.spec.ts for the live path).
  const env = Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined))
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [MCP_BIN],
      cwd: ROOT,
      env: { ...env, OBSRV_CONTROL_FILE: resolve(ROOT, 'tests/fixtures/no-such-control.json') },
    }),
  )
})

test.afterAll(async () => {
  await client?.close()
})

const call = (name: string, args: Record<string, unknown>): Promise<CallToolResult> =>
  client.callTool({ name, arguments: args }, undefined, { timeout: CALL_TIMEOUT_MS }) as Promise<CallToolResult>

test('initialize + tools/list: seven tools with schemas, honestly annotated', async () => {
  expect(client.getServerVersion()).toMatchObject({ name: 'obsrv-mcp-server' })

  const { tools } = await client.listTools()
  expect(tools.map(t => t.name).sort()).toEqual(['obsrv_audit', 'obsrv_diff', 'obsrv_drive', 'obsrv_inspect', 'obsrv_presets', 'obsrv_report', 'obsrv_snap'])
  for (const tool of tools) {
    expect(tool.description).toBeTruthy()
    // obsrv_drive mutates visible app state and says so; the rest are reads.
    expect(tool.annotations?.readOnlyHint).toBe(tool.name !== 'obsrv_drive')
    expect(tool.inputSchema).toMatchObject({ type: 'object' })
    expect(tool.outputSchema).toMatchObject({ type: 'object' })
  }
  const snap = tools.find(t => t.name === 'obsrv_snap')!
  expect(Object.keys(snap.inputSchema.properties ?? {})).toEqual(
    expect.arrayContaining(['url', 'preset', 'width', 'height', 'profile', 'fullPage', 'waitMs', 'timeoutMs', 'mode', 'textScale', 'throttle']),
  )
  const diff = tools.find(t => t.name === 'obsrv_diff')!
  expect(Object.keys(diff.inputSchema.properties ?? {})).toEqual(
    expect.arrayContaining(['url', 'preset', 'profile', 'includeImages', 'throttle']),
  )
  const drive = tools.find(t => t.name === 'obsrv_drive')!
  expect(Object.keys(drive.inputSchema.properties ?? {})).toEqual(
    expect.arrayContaining(['url', 'preset', 'profile', 'viewMode', 'textScale', 'throttle']),
  )
  const audit = tools.find(t => t.name === 'obsrv_audit')!
  expect(Object.keys(audit.inputSchema.properties ?? {})).toEqual(
    expect.arrayContaining(['url', 'preset', 'width', 'height', 'diagonalInches', 'tapMm', 'textMm', 'textScale']),
  )
  // Layout, not pixels: no panel profile.
  expect(Object.keys(audit.inputSchema.properties ?? {})).not.toContain('profile')
})

test('obsrv_audit: the fixture measured in millimetres on a 6.5" phone', async () => {
  const r = await call('obsrv_audit', { url: fixture('audit.html'), preset: 'android-65' })
  expect(r.isError).toBeFalsy()
  const result = r.structuredContent as {
    ppi: number
    thresholds: { tapMm: number; textMm: number }
    findings: { kind: string; element: string; mm: number }[]
    summary: { targets: { count: number; under: number }; text: { count: number; under: number } }
  }
  expect(result.ppi).toBeCloseTo(269.8, 0)
  expect(result.thresholds).toEqual({ tapMm: 7, textMm: 2 })
  expect(result.findings.map(f => f.kind)).toEqual(['small-text', 'small-text', 'small-target'])
  expect(result.findings[2]).toMatchObject({ element: 'button#tiny' })
  expect(result.summary.targets).toMatchObject({ count: 2, under: 1 })
})

test('obsrv_presets: the full catalog, straight from presets.ts', async () => {
  const r = await call('obsrv_presets', {})
  expect(r.isError).toBeFalsy()
  const catalog = r.structuredContent as {
    presets: { id: string; cssWidth: number; deviceScaleFactor: number; ppi: number }[]
    profiles: { id: string; contrastRatio: number | null; summary: string }[]
  }
  expect(catalog.presets).toHaveLength(22)
  expect(catalog.profiles).toHaveLength(4)
  const throttles = (r.structuredContent as { throttles: { id: string; cpuRate: number }[] }).throttles
  expect(throttles.map(t => t.id)).toEqual(['none', 'fast-4g', 'slow-4g', '3g', 'cpu-4x', 'cpu-6x', 'mid-phone', 'budget-phone'])
  expect(catalog.presets.find(p => p.id === 'laptop-768')).toMatchObject({ cssWidth: 1366, deviceScaleFactor: 1, ppi: 100 })
  expect(catalog.profiles.find(p => p.id === 'budget-tn')?.contrastRatio).toBe(700)
  // The text block carries the same payload for structured-content-blind clients.
  const text = r.content.find(c => c.type === 'text')
  expect(JSON.parse((text as { text: string }).text).presets).toHaveLength(22)
})

test('obsrv_snap: laptop-768 render returns metadata and an inline PNG', async () => {
  const r = await call('obsrv_snap', { url: fixture('hairline.html'), preset: 'laptop-768' })
  expect(r.isError).toBeFalsy()

  const meta = r.structuredContent as Record<string, unknown>
  expect(meta).toMatchObject({
    // No app is reachable, so the default auto mode reports headless.
    mode: 'headless',
    preset: 'laptop-768',
    cssWidth: 1366,
    cssHeight: 768,
    deviceScaleFactor: 1,
    profile: 'reference',
    settled: true,
    warnings: [],
  })
  expect(typeof meta.pngPath).toBe('string')
  expect(existsSync(meta.pngPath as string)).toBe(true)

  const image = r.content.find(c => c.type === 'image') as { data: string; mimeType: string } | undefined
  expect(image).toBeTruthy()
  expect(image!.mimeType).toBe('image/png')
  const png = Buffer.from(image!.data, 'base64')
  // PNG magic bytes: \x89PNG\r\n\x1a\n.
  expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  expect(Buffer.compare(png, readFileSync(meta.pngPath as string))).toBe(0)
})

test('obsrv_diff: thin text reproduces the ~0.5 row ratio, files on disk', async () => {
  const r = await call('obsrv_diff', { url: fixture('thin-text.html'), preset: 'laptop-768' })
  expect(r.isError).toBeFalsy()

  const m = r.structuredContent as {
    preset: string
    rows: { target: number; reference: number; ratio: number | null }
    bands: unknown[]
    findings: unknown[]
    files: { target: string; reference: string }
  }
  expect(m.preset).toBe('laptop-768')
  expect(m.rows.ratio).toBeGreaterThan(0.3)
  expect(m.rows.ratio).toBeLessThan(0.7)
  expect(m.bands).toHaveLength(8)
  expect(Array.isArray(m.findings)).toBe(true)
  expect(existsSync(m.files.target)).toBe(true)
  expect(existsSync(m.files.reference)).toBe(true)
  // No inline images unless includeImages is passed.
  expect(r.content.every(c => c.type !== 'image')).toBe(true)
})

test('obsrv_snap: an unknown preset is a tool error naming the valid ids', async () => {
  const r = await call('obsrv_snap', { url: fixture('hairline.html'), preset: 'nope' })
  expect(r.isError).toBe(true)
  const text = (r.content[0] as { text: string }).text
  expect(text).toContain('obsrv_snap')
  expect(text).toContain('laptop-768') // the message lists the valid options
})

test('obsrv_snap: preset plus custom dims is a usage error with the fix', async () => {
  const r = await call('obsrv_snap', { url: fixture('hairline.html'), preset: 'laptop-768', width: 100, height: 100 })
  expect(r.isError).toBe(true)
  expect((r.content[0] as { text: string }).text).toMatch(/mutually exclusive/)
})

test('live drive without a running app: snap mode:"live" and obsrv_drive error actionably', async () => {
  const snap = await call('obsrv_snap', { url: fixture('hairline.html'), mode: 'live' })
  expect(snap.isError).toBe(true)
  expect((snap.content[0] as { text: string }).text).toMatch(/Agent control/)

  const drive = await call('obsrv_drive', { preset: 'laptop-768' })
  expect(drive.isError).toBe(true)
  expect((drive.content[0] as { text: string }).text).toMatch(/Agent control/)
})

test('obsrv_report: one screen, rendered, audited and diffed, as a file plus a summary', async () => {
  const r = await call('obsrv_report', { url: fixture('audit.html'), presets: ['laptop-768'] })
  expect(r.isError).toBeFalsy()
  const result = r.structuredContent as {
    out: string
    htmlBytes: number
    screens: { preset: string; audit: { findings: number } | null; diff: { settled: boolean } | null; diffSkipped: string | null }[]
  }
  expect(result.out).toMatch(/obsrv-mcp-.*\/report\.html$/)
  expect(result.htmlBytes).toBeGreaterThan(10_000)
  expect(result.screens).toHaveLength(1)
  expect(result.screens[0]).toMatchObject({ preset: 'laptop-768', diffSkipped: null })
  expect(result.screens[0]!.audit?.findings).toBeGreaterThanOrEqual(1)
  expect(result.screens[0]!.diff).not.toBeNull()
})

test('obsrv_inspect (headless, no app): the grey caption by selector, in millimetres and contrast on a budget panel', async () => {
  const r = await call('obsrv_inspect', { url: fixture('contrast.html'), selector: '#grey', preset: 'laptop-768', profile: 'budget-tn' })
  expect(r.isError).toBeFalsy()
  const m = r.structuredContent as {
    mode: string
    found: boolean
    readout: { element: string; font: { px: number; mm: number }; color: string; contrast: { asIs: number; onPanel: number; panel: string } }
  }
  expect(m.mode).toBe('headless')
  expect(m.found).toBe(true)
  expect(m.readout.element).toBe('p#grey')
  expect(m.readout.font.px).toBe(13)
  expect(m.readout.font.mm).toBeCloseTo(3.29, 1)
  expect(m.readout.color).toBe('#6b7280')
  expect(m.readout.contrast.panel).toBe('budget-tn')
  expect(m.readout.contrast.onPanel).toBeLessThan(m.readout.contrast.asIs)

  const none = await call('obsrv_inspect', { url: fixture('contrast.html'), selector: '#nope' })
  expect(none.isError).toBeFalsy()
  expect(none.structuredContent).toMatchObject({ found: false, readout: null })

  const neither = await call('obsrv_inspect', { url: fixture('contrast.html') })
  expect(neither.isError).toBe(true)
  expect((neither.content[0] as { text: string }).text).toMatch(/exactly one of `at`/)
  const live = await call('obsrv_inspect', { selector: 'p', mode: 'live' })
  expect(live.isError).toBe(true)
  expect((live.content[0] as { text: string }).text).toMatch(/Agent control/)
})
