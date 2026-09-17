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
      env: { ...env, OBSRV_TEST: '1', OBSRV_CONTROL_FILE: resolve(ROOT, 'tests/fixtures/no-such-control.json') },
    }),
  )
  // Cache every tool's output schema before any test calls one.
  //
  // The SDK client validates a reply against the tool's output schema ONLY if
  // it holds that schema, and it holds it only once `listTools()` has run
  // (`client/index.js`: `getToolOutputValidator`, then `if (validator)`).
  // Without this line the first test to call `tools/list` switches validation
  // on for everything after it and nothing before it — and, worse, a
  // Playwright RETRY re-runs only the failed test against a fresh client, so
  // `tools/list` never runs and the retry is not validated at all.
  //
  // That is not hypothetical: `mcp.spec:137` failed its first attempt and
  // passed on retry 82 times, and every one of those greens was a run with
  // the check switched off. `--retries=1` was not absorbing a flake, it was
  // removing the instrument. Filtering with `-g` does the same thing, which
  // is how it was found.
  await client.listTools()
})

test.afterAll(async () => {
  await client?.close()
})

const call = (name: string, args: Record<string, unknown>): Promise<CallToolResult> =>
  client.callTool({ name, arguments: args }, undefined, { timeout: CALL_TIMEOUT_MS }) as Promise<CallToolResult>

test('initialize + tools/list: seven tools with schemas, honestly annotated', async () => {
  expect(client.getServerVersion()).toMatchObject({ name: 'obsrv-mcp-server' })

  const { tools } = await client.listTools()
  expect(tools.map(t => t.name).sort()).toEqual([
    'obsrv_audit',
    'obsrv_diff',
    'obsrv_drive',
    'obsrv_inspect',
    'obsrv_lint',
    'obsrv_presets',
    'obsrv_report',
    'obsrv_snap',
  ])
  for (const tool of tools) {
    expect(tool.description).toBeTruthy()
    // obsrv_drive mutates visible app state and says so; the rest are reads.
    expect(tool.annotations?.readOnlyHint).toBe(tool.name !== 'obsrv_drive')
    expect(tool.inputSchema).toMatchObject({ type: 'object' })
    expect(tool.outputSchema).toMatchObject({ type: 'object' })
  }
  const snap = tools.find(t => t.name === 'obsrv_snap')!
  expect(Object.keys(snap.inputSchema.properties ?? {})).toEqual(
    expect.arrayContaining(['url', 'preset', 'width', 'height', 'profile', 'fullPage', 'tiled', 'singleSurface', 'waitMs', 'timeoutMs', 'mode', 'textScale', 'throttle']),
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
    expect.arrayContaining(['url', 'mode', 'preset', 'width', 'height', 'diagonalInches', 'tapMm', 'textMm', 'textScale']),
  )
  // Layout, not pixels: no panel profile.
  expect(Object.keys(audit.inputSchema.properties ?? {})).not.toContain('profile')
})

test('obsrv_snap under the harness is headless for a named reason, and never launches', async () => {
  const r = await call('obsrv_snap', { url: fixture('solid-red.html'), preset: 'laptop-768' })
  expect(r.isError).toBeFalsy()
  const s = r.structuredContent as { mode: string; why?: string; launched?: boolean; warnings: string[] }
  expect(s.mode).toBe('headless')
  expect(s.why).toBe('no-display')
  expect(s.launched).toBeUndefined()
  expect(s.warnings.join(' ')).toMatch(/OBSRV_TEST/)
})

test('obsrv_snap mode: headless says requested; fullPage says headless-only', async () => {
  const a = (await call('obsrv_snap', { url: fixture('solid-red.html'), mode: 'headless' })).structuredContent as { why?: string }
  expect(a.why).toBe('requested')
  const b = (await call('obsrv_snap', { url: fixture('tall.html'), fullPage: true })).structuredContent as { why?: string }
  expect(b.why).toBe('headless-only')
})

test('obsrv_snap mode: live under the harness is an error naming the reason', async () => {
  const r = await call('obsrv_snap', { url: fixture('solid-red.html'), mode: 'live' })
  expect(r.isError).toBe(true)
  expect(JSON.stringify(r.content)).toMatch(/no-display.*OBSRV_TEST/)
})

test('obsrv_snap mode: live with a headless-only operation blames the operation, not the app (Finding 4)', async () => {
  // fullPage cannot run live at all — the app may be perfectly reachable, so
  // the old wording ("the live app is not available") blamed the wrong
  // thing. Reachability is exactly what the test above already covers.
  const r = await call('obsrv_snap', { url: fixture('tall.html'), mode: 'live', fullPage: true })
  expect(r.isError).toBe(true)
  const text = JSON.stringify(r.content)
  expect(text).toMatch(/cannot run this call/)
  expect(text).not.toMatch(/live app is not available/)
  expect(text).toMatch(/fullPage is headless-only/)
})

test('obsrv_audit/lint/inspect mode: live with custom dimensions blame the operation too (Finding 4 twins)', async () => {
  const a = await call('obsrv_audit', { url: fixture('audit.html'), mode: 'live', width: 800, height: 600 })
  const l = await call('obsrv_lint', { url: fixture('lint.html'), mode: 'live', width: 800, height: 600 })
  const i = await call('obsrv_inspect', { url: fixture('audit.html'), selector: 'button', mode: 'live', width: 800, height: 600 })
  for (const r of [a, l, i]) {
    expect(r.isError).toBe(true)
    const text = JSON.stringify(r.content)
    expect(text).toMatch(/cannot run this call/)
    expect(text).not.toMatch(/live app is not available/)
  }
})

// The next three tests pin sentences no run had carried in a reply
// (docs/note-inventory.md, "Written but not seen to fire", c5). The suite asked
// for custom dimensions only under mode: "live", where the sentence rides the
// error above, never in auto mode, where it is a note on a headless answer.
// One test per tool, so a failure names the tool that dropped its sentence.
for (const { tool, page, field, sentence, extra } of [
  { tool: 'obsrv_snap', page: 'solid-red.html', field: 'warnings', sentence: 'custom dimensions are headless-only (live mode drives the preset table); rendered headlessly.', extra: {} },
  { tool: 'obsrv_audit', page: 'audit.html', field: 'notes', sentence: 'custom dimensions are headless-only (live mode audits the screen in force); audited headlessly.', extra: {} },
  { tool: 'obsrv_lint', page: 'lint.html', field: 'notes', sentence: 'custom dimensions are headless-only (live mode lints the screen in force); linted headlessly.', extra: {} },
  { tool: 'obsrv_inspect', page: 'audit.html', field: 'notes', sentence: 'custom dimensions are headless-only (live mode inspects the screen in force); inspected headlessly.', extra: { selector: 'button' } },
] as const) {
  test(`${tool} in auto mode with custom dimensions renders headlessly, and says why`, async () => {
    const r = await call(tool, { url: fixture(page), width: 800, height: 600, ...extra })
    expect(r.isError).toBeFalsy()
    expect(r.structuredContent).toMatchObject({ mode: 'headless', why: 'headless-only' })
    expect((r.structuredContent as Record<string, string[]>)[field]).toContain(sentence)
  })
}

test("capture: 'pane' on a headless render says it was ignored", async () => {
  const r = await call('obsrv_snap', { url: fixture('solid-red.html'), mode: 'headless', capture: 'pane' })
  expect(r.isError).toBeFalsy()
  expect((r.structuredContent as { warnings: string[] }).warnings).toContain(
    "capture: 'pane' applies to live mode only; the headless render is the page raster itself, so the option was ignored.",
  )
})

test('OBSRV_HEADLESS=1 renders headlessly and names the variable, before the harness is asked', async () => {
  const env = Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined))
  const headless = new Client({ name: 'obsrv-mcp-spec-headless', version: '0.0.0' })
  await headless.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [MCP_BIN],
      cwd: ROOT,
      env: { ...env, OBSRV_TEST: '1', OBSRV_HEADLESS: '1', OBSRV_CONTROL_FILE: resolve(ROOT, 'tests/fixtures/no-such-control.json') },
    }),
  )
  try {
    // Validated against the output schema, as the main client is (see beforeAll).
    await headless.listTools()
    const r = (await headless.callTool(
      { name: 'obsrv_snap', arguments: { url: fixture('solid-red.html'), preset: 'laptop-768' } },
      undefined,
      { timeout: CALL_TIMEOUT_MS },
    )) as CallToolResult
    expect(r.isError).toBeFalsy()
    const s = r.structuredContent as { mode: string; why?: string; warnings: string[] }
    expect(s).toMatchObject({ mode: 'headless', why: 'no-display' })
    expect(s.warnings).toContain('no display: OBSRV_HEADLESS=1 is set; rendered headlessly.')
    // The variable decides before a launch is considered, so the harness's own
    // sentence (OBSRV_TEST forbids launching) never comes up.
    expect(s.warnings.join(' ')).not.toMatch(/OBSRV_TEST/)
  } finally {
    await headless.close()
  }
})

test('a deprecated orientation that inverts on this preset says so, and the answer says what the screen actually is', async () => {
  // `orientation` names the preset's STORED form, so 'landscape' on a preset
  // stored landscape turns it and gives a PORTRAIT screen. #241 wrote the
  // sentence for exactly that trap and no reply had carried it (c5): the
  // suite only ever passed an orientation that agreed with the shape.
  const r = await call('obsrv_snap', { url: fixture('solid-red.html'), preset: '1080p-24', orientation: 'landscape' })
  expect(r.isError).toBeFalsy()
  const s = r.structuredContent as { rotated?: boolean; screenShape?: string; cssWidth: number; cssHeight: number; warnings: string[] }
  expect(s).toMatchObject({ rotated: true, cssWidth: 1080, cssHeight: 1920 })
  // `screenShape` is live-only, as its schema says, so a headless answer states
  // the shape through `rotated` and the applied dimensions instead. Asserted
  // because the first draft of this test expected it and CI said otherwise.
  expect(s.screenShape).toBeUndefined()
  expect(s.warnings.join('\n'), JSON.stringify(s.warnings)).toContain(
    "orientation: 'landscape' produced a portrait screen (1080x1920). That flag names the preset's STORED form rather than the shape you get, " +
      'so the word inverts on presets stored the other way round. Use rotate: true to say it directly; screenShape always reports what you actually got.',
  )
})

test('audit, lint and inspect name why they ran headless, like snap', async () => {
  const a = (await call('obsrv_audit', { url: fixture('audit.html'), preset: 'laptop-768' })).structuredContent as { mode: string; why?: string }
  const l = (await call('obsrv_lint', { url: fixture('lint.html'), preset: 'laptop-768' })).structuredContent as { mode: string; why?: string }
  const i = (await call('obsrv_inspect', { url: fixture('audit.html'), preset: 'laptop-768', selector: 'button' })).structuredContent as { mode: string; why?: string }
  for (const s of [a, l, i]) expect(s).toMatchObject({ mode: 'headless', why: 'no-display' })
})

test('obsrv_audit: the fixture measured in millimetres on a 6.5" phone', async () => {
  const r = await call('obsrv_audit', { url: fixture('audit.html'), preset: 'android-65' })
  expect(r.isError).toBeFalsy()
  // No app in this suite: auto mode is a headless load, and says why.
  const s = r.structuredContent as { mode: string; why?: string; notes: string[] }
  expect(s).toMatchObject({ mode: 'headless', why: 'no-display' })
  expect(s.notes.join(' ')).toMatch(/OBSRV_TEST/)
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

test('obsrv_lint: the fixture judged on a 24" 1080p, headless, with the panel', async () => {
  const r = await call('obsrv_lint', { url: fixture('lint.html'), preset: '1080p-24', profile: 'budget-tn' })
  expect(r.isError).toBeFalsy()
  const m = r.structuredContent as {
    mode: string
    why?: string
    profile: string
    summary: Record<string, number>
    findings: { rule: string; element: string; rect: { width: number } }[]
    notes: string[]
  }
  expect(m).toMatchObject({ mode: 'headless', why: 'no-display', profile: 'budget-tn' })
  expect(m.notes.join(' ')).toMatch(/OBSRV_TEST/)
  expect(m.summary).toEqual({ hairline: 2, 'thin-text': 1, contrast: 1, 'contrast-on-panel': 1, 'image-upscaled': 1, 'image-oversized': 1 })
  expect(m.findings.map(f => f.rule)).toEqual(['hairline', 'hairline', 'thin-text', 'contrast', 'contrast-on-panel', 'image-upscaled', 'image-oversized'])
  expect(m.findings.find(f => f.rule === 'contrast-on-panel')!.element).toBe('p#grey')
  for (const f of m.findings) expect(f.rect.width).toBeGreaterThan(0)
  const nourl = await call('obsrv_lint', { mode: 'headless' })
  expect(nourl.isError).toBe(true)
})

test('obsrv_presets: the full catalog, straight from presets.ts', async () => {
  const r = await call('obsrv_presets', {})
  expect(r.isError).toBeFalsy()
  const catalog = r.structuredContent as {
    presets: { id: string; cssWidth: number; deviceScaleFactor: number; ppi: number }[]
    profiles: { id: string; contrastRatio: number | null; summary: string }[]
  }
  expect(catalog.presets).toHaveLength(26)
  expect(catalog.profiles).toHaveLength(4)
  const throttles = (r.structuredContent as { throttles: { id: string; cpuRate: number }[] }).throttles
  expect(throttles.map(t => t.id)).toEqual(['none', 'fast-4g', 'slow-4g', '3g', 'cpu-4x', 'cpu-6x', 'mid-phone', 'budget-phone'])
  expect(catalog.presets.find(p => p.id === 'laptop-768')).toMatchObject({ cssWidth: 1366, deviceScaleFactor: 1, ppi: 100 })
  expect(catalog.profiles.find(p => p.id === 'budget-tn')?.contrastRatio).toBe(700)
  // The text block carries the same payload for structured-content-blind clients.
  const text = r.content.find(c => c.type === 'text')
  expect(JSON.parse((text as { text: string }).text).presets).toHaveLength(26)
})

test('obsrv_snap: laptop-768 render returns metadata and an inline PNG', async () => {
  const r = await call('obsrv_snap', { url: fixture('hairline.html'), preset: 'laptop-768' })
  expect(r.isError).toBeFalsy()

  const meta = r.structuredContent as Record<string, unknown>
  expect(meta).toMatchObject({
    // No app is reachable, and OBSRV_TEST=1 forbids launching one, so the
    // default auto mode reports headless and says why.
    mode: 'headless',
    why: 'no-display',
    preset: 'laptop-768',
    cssWidth: 1366,
    cssHeight: 768,
    deviceScaleFactor: 1,
    profile: 'reference',
    settled: true,
  })
  expect((meta.warnings as string[]).join(' ')).toMatch(/OBSRV_TEST/)
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

test('live drive without a running app: snap mode:"live" and obsrv_drive both name why', async () => {
  // obsrv_snap now resolves through ensureLive, which under this harness
  // (OBSRV_TEST=1, no reachable app) reports headless with a reason rather
  // than the old generic "not reachable" text — see the dedicated
  // "mode: live under the harness" test above for the exact wording.
  const snap = await call('obsrv_snap', { url: fixture('hairline.html'), mode: 'live' })
  expect(snap.isError).toBe(true)
  const snapText = (snap.content[0] as { text: string }).text
  expect(snapText).toMatch(/no-display/)
  expect(snapText).toMatch(/OBSRV_TEST/)

  // obsrv_drive (Task 10) also resolves through ensureLive now, rather than
  // discoverControl directly, so it reports the same kind of reason.
  const drive = await call('obsrv_drive', { preset: 'laptop-768' })
  expect(drive.isError).toBe(true)
  const driveText = (drive.content[0] as { text: string }).text
  expect(driveText).toMatch(/no-display/)
  expect(driveText).toMatch(/OBSRV_TEST/)

  // A call with no inputs takes the same path: there is no current state to
  // read without an app, and it resolves one the way every drive call does,
  // by launching it when it may (bug-drive-empty-call-launches-the-app).
  const empty = await call('obsrv_drive', {})
  expect(empty.isError).toBe(true)
  expect((empty.content[0] as { text: string }).text).toMatch(/OBSRV_TEST/)
})

test('obsrv_drive says it launches the app where an agent decides whether a call is safe', async () => {
  // "none = just read the current state" read as the one safe call, and the
  // sentence saying the app is launched was the last paragraph of a long
  // description (bug-drive-empty-call-launches-the-app).
  const { tools } = await client.listTools()
  const description = tools.find(t => t.name === 'obsrv_drive')!.description!
  // In the opening paragraph, where the other tools that launch say it.
  expect(description.split('\n\n')[0]).toContain('any call launches it first')
  expect(description.split('\n\n')[0]).toContain('including a call with no inputs')
  // And inside the clause that describes the empty call.
  const at = description.indexOf('none = ')
  expect(at).toBeGreaterThan(-1)
  expect(description.slice(at, description.indexOf(')', at))).toContain('launches the app')
  expect(description).not.toContain('just read the current state')
})

test('obsrv_report: one screen, rendered, audited and diffed, as a file plus a summary', async () => {
  const r = await call('obsrv_report', { url: fixture('audit.html'), presets: ['laptop-768'] })
  expect(r.isError).toBeFalsy()
  const result = r.structuredContent as {
    out: string
    htmlBytes: number
    screens: {
      preset: string
      walked?: { screenfuls: number; atEnd: boolean; ms: number }
      audit: { findings: number } | null
      diff: { settled: boolean } | null
      diffSkipped: string | null
    }[]
  }
  expect(result.out).toMatch(/obsrv-mcp-.*\/report\.html$/)
  expect(result.htmlBytes).toBeGreaterThan(10_000)
  expect(result.screens).toHaveLength(1)
  expect(result.screens[0]).toMatchObject({ preset: 'laptop-768', diffSkipped: null })
  // Each screen was walked before its audit and lint; the output schema must
  // admit the field, or the whole answer is refused as "additional properties".
  expect(result.screens[0]!.walked).toMatchObject({ atEnd: true })
  expect(result.screens[0]!.audit?.findings).toBeGreaterThanOrEqual(1)
  expect(result.screens[0]!.diff).not.toBeNull()
})

test('obsrv_inspect (headless, no app): the grey caption by selector, in millimetres and contrast on a budget panel', async () => {
  const r = await call('obsrv_inspect', { url: fixture('contrast.html'), selector: '#grey', preset: 'laptop-768', profile: 'budget-tn' })
  expect(r.isError).toBeFalsy()
  const m = r.structuredContent as {
    mode: string
    found: boolean
    readout: {
      element: string
      font: { px: number; mm: number }
      color: string
      colorPainted: string
      contrast: { asIs: number; onPanel: number; panel: string }
    }
  }
  expect(m.mode).toBe('headless')
  expect(m.found).toBe(true)
  expect(m.readout.element).toBe('p#grey')
  expect(m.readout.font.px).toBe(13)
  expect(m.readout.font.mm).toBeCloseTo(3.29, 1)
  expect(m.readout.color).toBe('#6b7280')
  // The VALUE, not the absence of an error. A field declared in the schema and
  // never populated passes :137 — that test only proves the reply validates.
  // #grey is fully opaque, so the painted colour is the stated one.
  expect(m.readout.colorPainted).toBe('#6b7280')
  expect(m.readout.contrast.panel).toBe('budget-tn')
  expect(m.readout.contrast.onPanel).toBeLessThan(m.readout.contrast.asIs)

  const none = await call('obsrv_inspect', { url: fixture('contrast.html'), selector: '#nope' })
  expect(none.isError).toBeFalsy()
  expect(none.structuredContent).toMatchObject({ found: false, readout: null })
  expect((none.structuredContent as { notes: string[] }).notes.filter(n => n.includes('valid CSS selector'))).toEqual([])

  // A string the browser will not accept is not a miss, and an agent that
  // typos one needs to be told which of the two it got (bug-inspect-selector-silences).
  const bad = await call('obsrv_inspect', { url: fixture('contrast.html'), selector: 'p[' })
  expect(bad.isError).toBeFalsy()
  const badOut = bad.structuredContent as { found: boolean; readout: null; notes: string[] }
  expect(badOut).toMatchObject({ found: false, readout: null })
  // Filtered: this surface also carries the note about having rendered headlessly.
  expect(badOut.notes.filter(n => n.includes('valid CSS selector')), JSON.stringify(badOut.notes)).toEqual([
    expect.stringContaining('is not a valid CSS selector, so nothing was looked for'),
  ])

  const neither = await call('obsrv_inspect', { url: fixture('contrast.html') })
  expect(neither.isError).toBe(true)
  expect((neither.content[0] as { text: string }).text).toMatch(/exactly one of `at`/)
  const live = await call('obsrv_inspect', { selector: 'p', mode: 'live' })
  expect(live.isError).toBe(true)
  const liveText = (live.content[0] as { text: string }).text
  expect(liveText).toMatch(/no-display/)
  expect(liveText).toMatch(/OBSRV_TEST/)
})

test('obsrv_presets: a group answers with those presets alone, and phones is a name for mobile', async () => {
  const r = await call('obsrv_presets', { group: 'phones' })
  expect(r.isError).toBeFalsy()
  const c = r.structuredContent as { presets: { group: string }[]; throttles?: unknown; profiles?: unknown; orientation?: unknown }
  expect(c.presets.length).toBeGreaterThan(3)
  expect(c.presets.every(p => p.group === 'mobile')).toBe(true)
  expect(c.throttles).toBeUndefined()
  expect(c.profiles).toBeUndefined()
  expect(c.orientation).toBeUndefined()
})

test('obsrv_lint: groups carry a slim exemplar, and groupsOnly leaves the list out', async () => {
  const r = await call('obsrv_lint', { url: fixture('lint.html'), preset: '1080p-24', groupsOnly: true })
  expect(r.isError).toBeFalsy()
  const m = r.structuredContent as { findings: unknown[]; groups: { exemplar: Record<string, unknown> }[]; summary: Record<string, number>; skipped: Record<string, number> }
  expect(m.findings).toEqual([])
  expect(m.summary.hairline).toBe(2)
  expect(Object.keys(m.groups[0]!.exemplar).sort()).toEqual(['element', 'message', 'rect', 'text'])
  expect(m.skipped).toEqual({ textOnImages: 1, invisibleText: 0, spacers: 0 })
})

test('groupsOnly says the list was left out by request, on audit and lint, and nothing says it without the flag', async () => {
  // `findings: []` beside `truncated.findings: 0` is right under the flag and
  // reads exactly like a clean page. Run 19 read it that way, with only
  // `summary` and `groups` disagreeing (bug-groups-only-empties-findings-silently).
  for (const [tool, page] of [['obsrv_audit', 'audit.html'], ['obsrv_lint', 'lint.html']] as const) {
    const grouped = (await call(tool, { url: fixture(page), preset: 'laptop-768', groupsOnly: true })).structuredContent as {
      findings: unknown[]
      groups: unknown[]
      notes: string[]
    }
    expect(grouped.findings).toEqual([])
    // A fixture with nothing to group would make the note's absence and presence equally meaningless.
    expect(grouped.groups.length, `${tool}: the fixture has nothing to group`).toBeGreaterThan(0)
    expect(grouped.notes.filter(n => n.includes('groupsOnly')), `${tool} notes: ${JSON.stringify(grouped.notes)}`).toHaveLength(1)
    // Each tool names where its findings went in its own terms: an audit's `summary.*.count` is
    // everything measured, so its note has to point at `under`, not at `summary` as a whole.
    const note = grouped.notes.find(n => n.includes('groupsOnly'))!
    expect(note).toContain(tool === 'obsrv_audit' ? '`summary.targets.under`' : 'counted in `summary`')

    const listed = (await call(tool, { url: fixture(page), preset: 'laptop-768' })).structuredContent as {
      findings: unknown[]
      notes: string[]
    }
    expect(listed.findings.length, `${tool}: the control lists nothing, so it controls nothing`).toBeGreaterThan(0)
    expect(listed.notes.some(n => n.includes('groupsOnly')), `${tool} without the flag, notes: ${JSON.stringify(listed.notes)}`).toBe(false)
  }
})

test("a measurement of a cut load answers with the page as it stands and the CLI's sentence, not Chromium's log", async () => {
  // theverge.com never finished loading and the error was a kilobyte of
  // task_policy_set lines with the one useful sentence last.
  const { createServer } = await import('node:http')
  const server = createServer((req, res) => {
    if (req.url === '/never.js') return
    res.setHeader('Content-Type', 'text/html')
    res.end('<!doctype html><title>hanging</title><p>here</p><script src="/never.js"></script>')
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  const port = (server.address() as { port: number }).port
  try {
    const r = await call('obsrv_lint', { url: `http://127.0.0.1:${port}/`, preset: '1080p-24', timeoutMs: 1500 })
    // A cut load is measured as it stands since 0.53.0: the answer is the
    // page's, with the CLI's sentence first — and never Chromium's log.
    expect(r.isError, JSON.stringify(r.content).slice(0, 300)).toBeFalsy()
    const m = r.structuredContent as { warnings: string[] }
    expect(m.warnings[0]).toMatch(/^load did not finish within 1500 ms: http:\/\/127\.0\.0\.1:\d+\/ — measured the page as it stood/)
    const text = JSON.stringify(r.content)
    expect(text).not.toContain('task_policy_set')
    expect(text).not.toContain('electron:')
  } finally {
    server.closeAllConnections?.()
    await new Promise<void>(r => server.close(() => r()))
  }
})

test('obsrv_lint: an image finding carries the object-fit it was judged by, and the schema admits it', async () => {
  const r = await call('obsrv_lint', { url: fixture('object-fit.html'), preset: '1080p-24' })
  expect(r.isError, JSON.stringify(r.content)).toBeFalsy()
  const m = r.structuredContent as { summary: Record<string, number>; findings: { element: string; rule: string; objectFit?: string; factor?: number; message: string }[] }
  expect(m.summary['image-upscaled']).toBe(2)
  const cover = m.findings.find(f => f.element === 'img#cover')
  expect(cover).toMatchObject({ rule: 'image-upscaled', objectFit: 'cover' })
  expect(cover!.message).toContain('object-fit: cover')
})

test('obsrv_inspect: the layout-scale note is said once, in the readout', async () => {
  const r = await call('obsrv_inspect', { url: fixture('noviewport.html'), preset: 'android-65', selector: '#b' })
  expect(r.isError).toBeFalsy()
  const m = r.structuredContent as { readout: { notes: string[]; layoutScale: number }; notes: string[] }
  expect(m.readout.layoutScale).toBeCloseTo(0.3673, 3)
  expect(m.readout.notes.join(' ')).toMatch(/no viewport meta tag/)
  expect(m.notes.join(' ')).not.toMatch(/no viewport meta tag/)
})

test('a page that holds its main thread after load is answered, not killed: the measurement has its own budget', async () => {
  // stackoverflow.com's challenge held obsrv_audit past the 90 s kill and the answer was lost.
  const started = Date.now()
  const r = await call('obsrv_audit', { url: fixture('blocks-after-load.html'), preset: '1080p-24', timeoutMs: 3000 })
  expect(r.isError, JSON.stringify(r.content).slice(0, 300)).toBeFalsy()
  expect(Date.now() - started).toBeLessThan(30_000)
  const m = r.structuredContent as { summary: { targets: { count: number } }; warnings: string[] }
  expect(m.summary.targets.count).toBe(0)
  expect(m.warnings[0]).toMatch(/^the page did not answer the audit within 3 s of loading/)
})

test('obsrv_inspect: a page that holds its main thread after load answers found false within the budget, with the note', async () => {
  const r = await call('obsrv_inspect', { url: fixture('blocks-after-load.html'), preset: '1080p-24', selector: '#b', timeoutMs: 3000 })
  expect(r.isError, JSON.stringify(r.content).slice(0, 300)).toBeFalsy()
  const m = r.structuredContent as { found: boolean; notes: string[] }
  expect(m.found).toBe(false)
  expect(m.notes.join(' ')).toMatch(/the page did not answer the inspect within 3 s of loading/)
})

test('obsrv_audit: groupsOnly leaves the list out, as it does for lint', async () => {
  // A phone audit of a retail page came back as fifteen thousand tokens with
  // no way to ask for the groups alone; lint had had the flag since 0.32.0.
  const r = await call('obsrv_audit', { url: fixture('audit.html'), preset: '1080p-24', groupsOnly: true })
  expect(r.isError).toBeFalsy()
  const m = r.structuredContent as { findings: unknown[]; groups: { kind: string; count: number }[]; summary: { targets: { under: number } }; warnings: string[] }
  expect(m.findings).toEqual([])
  expect(m.groups.length).toBeGreaterThan(0)
  expect(m.summary.targets.under).toBe(1)
  expect(m.warnings.join(' ')).not.toMatch(/past the 200 listed/)
})

test('a PNG over the inline cap says so in the JSON, not only in a text block', async () => {
  // 1920×1080 of seeded noise: a PNG of several MiB whatever the encoder does.
  const big = await call('obsrv_snap', { url: fixture('noise.html'), preset: '1080p-24', mode: 'headless' })
  expect(big.isError).toBeFalsy()
  const m = big.structuredContent as { inlined: boolean; warnings: string[]; pngPath: string }
  expect(m.inlined).toBe(false)
  expect(m.warnings.join(' ')).toMatch(/over the 1\.5 MiB inline cap/)
  expect(m.warnings.join(' ')).toContain(m.pngPath)
  expect(big.content.some(c => c.type === 'image')).toBe(false)

  const small = await call('obsrv_snap', { url: fixture('solid-red.html'), preset: 'laptop-768', mode: 'headless' })
  const s = small.structuredContent as { inlined: boolean; warnings: string[] }
  expect(s.inlined).toBe(true)
  expect(s.warnings.join(' ')).not.toMatch(/inline cap/)
  expect(small.content.some(c => c.type === 'image')).toBe(true)
})

test('parallel calls queue behind a render cap instead of starving each other', async () => {
  // Nine at once used to be nine Electrons, and two apple.com loads died at
  // their 30 s budget while alone each passed. The cap is two (OBSRV_MCP_CONCURRENCY);
  // the rest wait their turn, and a call that waited says so.
  const calls = Array.from({ length: 5 }, () => call('obsrv_snap', { url: fixture('solid-red.html'), preset: 'laptop-768', mode: 'headless' }))
  const results = await Promise.all(calls)
  for (const r of results) expect(r.isError, JSON.stringify(r.content).slice(0, 300)).toBeFalsy()
  const waited = results.filter(r => ((r.structuredContent as { warnings: string[] }).warnings ?? []).some(w => /waited .* for a render slot/.test(w)))
  expect(waited.length).toBeGreaterThanOrEqual(1)
  expect(waited.length).toBeLessThanOrEqual(3)
})

test('every unsettled reason the CLI can produce is admitted by the snap and report output schemas', async () => {
  // A reason the schema does not list makes the whole answer an "Output
  // validation error" — the branch build of the cut-load fix refused its own
  // `loading` on obsrv_snap while the report schema, edited the same day,
  // took it.
  const { tools } = await client.listTools()
  const reasons = ['animating', 'timeout', 'uncovered', 'blank', 'loading']
  // Only the live surface can be mid-resize, so `obsrv_snap` admits one
  // reason the CLI cannot produce. Named rather than tolerated: an equality
  // check said the right thing until a live-only reason existed, and a bare
  // subset check would let the next one in unnoticed — which is the failure
  // this test was written for.
  const liveOnly = ['resizing']
  const snap = tools.find(t => t.name === 'obsrv_snap')!.outputSchema as { properties: Record<string, { enum?: string[] }> }
  expect(snap.properties.unsettledReason?.enum).toEqual([...reasons, ...liveOnly])
  // The report is headless by design and has no second surface to admit for.
  const report = tools.find(t => t.name === 'obsrv_report')!.outputSchema as { properties: Record<string, { items?: { properties: Record<string, { enum?: string[] }> } }> }
  expect(report.properties.screens?.items?.properties.unsettledReason?.enum).toEqual(reasons)
})

/**
 * `chore-strict-output-under-test`: the server checks its own reply against
 * its own output schema under `OBSRV_TEST=1`, and fails the call on a key the
 * schema does not declare.
 *
 * Each arm spawns its own server, because the fence is an environment
 * variable and the shared client above is already inside it. The poison is an
 * `OBSRV_TEST`-only hook (`strictOutput.ts`), and it exists so this check can
 * never be vacuous: without it the suite is green on a clean tree and nobody
 * learns whether the check runs at all — which is exactly what `ci.yml`'s
 * trace upload did for a week while it uploaded an empty directory and passed.
 */
test.describe('the server rejects its own undeclared key', () => {
  const callWith = async (env: Record<string, string>): Promise<CallToolResult> => {
    const base = Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined))
    const c = new Client({ name: 'obsrv-strict-spec', version: '0.0.0' })
    await c.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [MCP_BIN],
        cwd: ROOT,
        env: { ...base, OBSRV_CONTROL_FILE: resolve(ROOT, 'tests/fixtures/no-such-control.json'), ...env },
      }),
    )
    try {
      // No listTools(): this is the SERVER's check, and the point of it is
      // that it holds when the client's own validation is off — which is the
      // state a Playwright retry leaves every client in.
      return (await c.callTool({ name: 'obsrv_presets', arguments: {} })) as CallToolResult
    } finally {
      await c.close()
    }
  }
  const textOf = (r: CallToolResult): string => (r.content as { text?: string }[]).map(c => c.text ?? '').join('\n')

  test('a poisoned reply fails the call, naming the tool and the key', async () => {
    const poisoned = await callWith({ OBSRV_TEST: '1', OBSRV_TEST_UNDECLARED_KEY: 'obsrv_presets' })
    expect(poisoned.isError).toBe(true)
    const text = textOf(poisoned)
    expect(text).toContain('obsrv_presets emitted 1 key its own output schema does not declare')
    expect(text).toContain('obsrvTestUndeclaredKey')
    // It says what a client would do with the reply, so the reader knows this
    // is a real rejection and not a lint the server invented.
    expect(text).toContain('additionalProperties: false')
  })

  test('the same call is clean when nothing poisons it', async () => {
    const clean = await callWith({ OBSRV_TEST: '1' })
    expect(clean.isError, textOf(clean)).toBeFalsy()
    expect(textOf(clean)).not.toContain('does not declare')
  })

  test('with OBSRV_TEST unset, neither the hook nor the check runs', async () => {
    // The fence, held by a test rather than by the sentence that states it.
    // Both are fenced on the same variable, so this arm shows the poison stays
    // out of a user's reply AND that the check is not running there.
    //
    // What it does NOT show is a genuine undeclared key travelling to a user,
    // because producing one needs a tree that has one. That was measured
    // instead on `6755535`, where `obsrv_inspect` really did emit
    // `readout.colorPainted` undeclared: with the check on it is rejected by
    // name, and that is the arm this pair cannot supply.
    const production = await callWith({ OBSRV_TEST: '', OBSRV_TEST_UNDECLARED_KEY: 'obsrv_presets' })
    expect(production.isError, textOf(production)).toBeFalsy()
    expect(production.structuredContent).not.toHaveProperty('obsrvTestUndeclaredKey')
  })
})
