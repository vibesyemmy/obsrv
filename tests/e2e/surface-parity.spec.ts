import { expect, test, type ElectronApplication } from '@playwright/test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { CONTROL_FILE_NAME } from '../../src/shared/control'
import { noEvidenceMessage } from '../../src/shared/established'
import { launchApp } from './launch'

/**
 * C4: the two surfaces answer the same question the same way, or the
 * difference is written down.
 *
 * Every tool that offers `mode: 'headless' | 'live'` is called both ways on
 * the same page, and the two replies are compared **field by field** — the
 * set of key paths, the type at each path, and the value at each scalar path
 * that is not inherently per-run. Note *text* is recorded but not compared:
 * that is C5's question, and the 2026-09-13 sweep already asked it.
 *
 * The page tests report; the last test asserts. Which differences are defects
 * and which are intended was judged by reading the report (see the write-up
 * in docs/research/2026-09-14-c4-field-sweep.md); what survived that reading
 * is the EXPLAINED table at the foot of this file, and anything not in it
 * fails.
 */

const ROOT = resolve(__dirname, '../..')
const MCP_BIN = resolve(ROOT, 'bin/obsrv-mcp.js')
// Under the OS temp dir, not the repo: a spec that drops an untracked file
// in the working tree gets committed by someone eventually. PARITY_OUT puts
// it somewhere you will look.
const OUT = process.env.PARITY_OUT ?? join(tmpdir(), 'obsrv-parity-report.json')
const fixture = (name: string): string => pathToFileURL(resolve(__dirname, `../fixtures/${name}`)).href

const CALL_TIMEOUT_MS = 150_000
/** The one screen both surfaces measure, so a layout difference cannot masquerade as a surface difference. */
const PRESET = '1080p-24'
test.describe.configure({ mode: 'serial', timeout: 900_000 })

let app: ElectronApplication
let client: Client
let server: Server
let origin = ''

/** Routes only an HTTP origin can express: a redirect, and a status. */
const routes = (): Server =>
  createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0]
    if (path === '/redirect') {
      res.writeHead(302, { Location: '/landed' })
      res.end()
      return
    }
    if (path === '/landed') {
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end('<!doctype html><title>landed</title><main><h1>The page it landed on</h1><p>Body text here.</p><button>Press</button></main>')
      return
    }
    if (path === '/missing') {
      res.writeHead(404, { 'Content-Type': 'text/html' })
      res.end('')
      return
    }
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end('<!doctype html><title>plain</title><main><h1>Plain</h1><p>Body text.</p><button>Press</button></main>')
  })

test.beforeAll(async () => {
  server = routes()
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

  app = await launchApp([], { OBSRV_AGENT_CONTROL: '1' })
  const userData = await app.evaluate(({ app: a }) => a.getPath('userData'))
  const env = Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined))
  client = new Client({ name: 'obsrv-surface-parity', version: '0.0.0' })
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [MCP_BIN],
      cwd: ROOT,
      env: { ...env, OBSRV_CONTROL_FILE: join(userData, CONTROL_FILE_NAME) },
    }),
  )

  /**
   * Both surfaces must measure the same screen or nothing below is a
   * comparison. Live audits the screen in force and ignores `preset`, which
   * is intended and documented; headless defaults to 1080p-24. Without this
   * the two answers differ by layout, and a page whose panel only overflows
   * at one width reads as a surface that went silent.
   *
   * Orientation is deliberately passed on neither side. Passing it to the
   * drive and not to the headless call is what a first version of this spec
   * did, and it moved the live viewport to 1080x1920 while headless stayed
   * 1920x1080 — a divergence manufactured by the control that was supposed
   * to remove one. Both sides now take the preset's default.
   */
  const set = await client.callTool(
    { name: 'obsrv_drive', arguments: { preset: PRESET } },
    undefined,
    { timeout: CALL_TIMEOUT_MS },
  )
  console.log(`  screen in force: ${JSON.stringify((set.structuredContent as { presetId?: unknown })?.presetId)}`)
})

test.afterAll(async () => {
  await client?.close()
  await app?.close()
  await new Promise<void>((r) => server?.close(() => r()))
})

const call = (name: string, args: Record<string, unknown>): Promise<CallToolResult> =>
  client.callTool({ name, arguments: args }, undefined, { timeout: CALL_TIMEOUT_MS }) as Promise<CallToolResult>

// ---------------------------------------------------------------- the diff

type Shape = Map<string, string>

const kindOf = (v: unknown): string =>
  v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v

/**
 * Key paths with their types. Array elements collapse to one `[]` step, so a
 * reply with three findings and a reply with none differ in the *length* of
 * `findings` (a value question) rather than in its shape — unless one of them
 * carries a key inside a finding that the other never does.
 */
const shapeOf = (v: unknown, at = '', into: Shape = new Map()): Shape => {
  into.set(at || '.', kindOf(v))
  if (Array.isArray(v)) for (const el of v) shapeOf(el, `${at}[]`, into)
  else if (v && typeof v === 'object') for (const [k, val] of Object.entries(v)) shapeOf(val, at ? `${at}.${k}` : k, into)
  return into
}

/** Scalar values by path; arrays contribute their length, not their items. */
const valuesOf = (v: unknown, at = '', into = new Map<string, unknown>()): Map<string, unknown> => {
  if (Array.isArray(v)) into.set(`${at}.length`, v.length)
  else if (v && typeof v === 'object') for (const [k, val] of Object.entries(v)) valuesOf(val, at ? `${at}.${k}` : k, into)
  else if (at) into.set(at, v)
  return into
}

/**
 * Paths whose two answers are *supposed* to differ, because the thing they
 * report is the surface itself or is measured afresh on every run. Anything
 * not listed here is a difference this sweep wants a reason for.
 */
const PER_RUN = [
  /(^|\.)mode$/,
  /(^|\.)why$/,
  /(^|\.)ms$/,
  /Ms$/,
  /(^|\.)png$/,
  /(^|\.)out$/,
  /(^|\.)path$/,
  /(^|\.)elapsed/,
  /(^|\.)notes\.length$/,
  /(^|\.)warnings\.length$/,
]
const perRun = (p: string): boolean => PER_RUN.some((r) => r.test(p))

type Divergence = { path: string; headless: unknown; live: unknown; kind: 'shape' | 'value' }

const compare = (h: unknown, l: unknown, moving = false): Divergence[] => {
  const out: Divergence[] = []
  const [hs, ls] = [shapeOf(h), shapeOf(l)]
  for (const [p, t] of hs) {
    if (perRun(p)) continue
    const lt = ls.get(p)
    if (lt === undefined) out.push({ path: p, headless: t, live: '(absent)', kind: 'shape' })
    else if (lt !== t) out.push({ path: p, headless: t, live: lt, kind: 'shape' })
  }
  for (const [p, t] of ls) {
    if (perRun(p) || hs.has(p)) continue
    out.push({ path: p, headless: '(absent)', live: t, kind: 'shape' })
  }
  // A page that is still moving answers a different number to each reader,
  // and which reader got the larger one says nothing about the surfaces.
  if (moving) return out
  const [hv, lv] = [valuesOf(h), valuesOf(l)]
  for (const [p, v] of hv) {
    if (perRun(p) || !lv.has(p)) continue
    const w = lv.get(p)
    if (!Object.is(v, w)) out.push({ path: p, headless: v, live: w, kind: 'value' })
  }
  return out
}

// ------------------------------------------------------------- the corpus

/**
 * The page shapes each of which produced, or could produce, a divergence.
 *
 * `moving` marks a page whose geometry is different every time it is read,
 * because the page itself never stops. Values are not compared on those —
 * shape and type still are. Without it the harness reports a page doing
 * exactly what the fixture exists to make it do as a surface defect: CI
 * caught `pageHeight` at 1080 headless and 1065 live on `moves`, fifteen
 * pixels of a slide measured twice, while this machine happened to read the
 * same number twice and stayed quiet about it.
 */
const PAGES: { name: string; url: () => string; why: string; moving?: true }[] = [
  { name: 'ordinary', url: () => fixture('audit.html'), why: 'a page with targets and text and nothing unusual' },
  { name: 'shadow', url: () => fixture('half-in-shadow.html'), why: 'most of the page inside components' },
  { name: 'panel-locked', url: () => fixture('anon-panel-locked.html'), why: 'a locked page whose scroller is an element, with no dialog role' },
  { name: 'dialog-locked', url: () => fixture('dialog-locked.html'), why: 'the same, with the role' },
  { name: 'wall', url: () => fixture('wall-over-a-tall-page.html'), why: 'an iframe over a page that cannot move' },
  { name: 'tall', url: () => fixture('tall-audit.html'), why: 'more page than one screenful' },
  { name: 'empty', url: () => fixture('empty.html'), why: 'a document with nothing in it' },
  { name: 'moves', url: () => fixture('moves-while-measured.html'), why: 'a page that moves under the measurement', moving: true },
  { name: 'redirect', url: () => `${origin}/redirect`, why: 'a load that ends somewhere else' },
  { name: 'status-404', url: () => `${origin}/missing`, why: 'an empty document with a status that explains it' },
]

/** The tools that offer both surfaces, and the arguments each needs. */
const TOOLS: { tool: string; args: (url: string) => Record<string, unknown> }[] = [
  { tool: 'obsrv_audit', args: (url) => ({ url }) },
  { tool: 'obsrv_lint', args: (url) => ({ url }) },
  { tool: 'obsrv_inspect', args: (url) => ({ url, selector: 'body' }) },
  { tool: 'obsrv_snap', args: (url) => ({ url }) },
]

type Row = {
  page: string
  tool: string
  /**
   * What each reply says it is. Without this a row of zero divergences fits
   * two opposite facts: the surfaces agree, or both calls reached the same
   * surface. `mode` is excluded from the comparison precisely because it is
   * expected to differ, which is what makes it the check that it did.
   */
  surface: { headless?: unknown; live?: unknown }
  divergences: Divergence[]
  headlessError?: string
  liveError?: string
  notes: { headless: string[]; live: string[] }
}

const rows: Row[] = []

const textOf = (r: CallToolResult): string =>
  (r.content ?? []).map((c) => ('text' in c ? String(c.text) : '')).join('\n').slice(0, 400)

const notesIn = (v: unknown): string[] => {
  const o = (v ?? {}) as Record<string, unknown>
  const pick = (k: string): string[] => (Array.isArray(o[k]) ? (o[k] as unknown[]).map(String) : [])
  return [...pick('notes'), ...pick('warnings')]
}

for (const page of PAGES) {
  test(`parity: ${page.name}`, async () => {
    for (const { tool, args } of TOOLS) {
      const base = args(page.url())
      const row: Row = { page: page.name, tool, surface: {}, divergences: [], notes: { headless: [], live: [] } }
      let h: unknown
      let l: unknown
      try {
        const r = await call(tool, { ...base, preset: PRESET, mode: 'headless' })
        if (r.isError) row.headlessError = textOf(r)
        else h = r.structuredContent
      } catch (e) {
        row.headlessError = `threw: ${String(e).slice(0, 200)}`
      }
      try {
        const r = await call(tool, { ...base, mode: 'live' })
        if (r.isError) row.liveError = textOf(r)
        else l = r.structuredContent
      } catch (e) {
        row.liveError = `threw: ${String(e).slice(0, 200)}`
      }
      row.notes = { headless: notesIn(h), live: notesIn(l) }
      const witness = (v: unknown): Record<string, unknown> => {
        const o = (v ?? {}) as Record<string, unknown>
        const keys = ['mode', 'preset', 'presetId', 'pageHeight', 'viewport', 'orientation', 'screenShape', 'targets', 'layoutScale', 'walked', 'documentLocked']
        return Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, o[k]]))
      }
      row.surface = { headless: witness(h), live: witness(l) }
      if (h !== undefined && l !== undefined) row.divergences = compare(h, l, page.moving === true)
      rows.push(row)
      const tag = `${page.name}/${tool.replace('obsrv_', '')}`
      const surfaces = `${JSON.stringify(row.surface.headless)}|${JSON.stringify(row.surface.live)}`
      if (row.headlessError || row.liveError) console.log(`  ${tag}: ERROR h=${row.headlessError ?? '-'} l=${row.liveError ?? '-'}`)
      else console.log(`  ${tag}: ${row.divergences.length} divergence(s) [${surfaces}]`)
    }
    mkdirSync(dirname(OUT), { recursive: true })
    writeFileSync(OUT, JSON.stringify({ generated: new Date().toISOString(), rows }, null, 2))
  })
}

// ------------------------------------------------------------- the gate

/**
 * Every field difference between the two surfaces that has a reason, and the
 * reason. A divergence not in this table fails the run — which is the point
 * of the table: C4 is "the two surfaces answer the same question the same
 * way, or the difference is written down", and this is the writing-down, in
 * the one form that cannot go stale without going red.
 *
 * Which *pages* provoke a difference is deliberately not pinned. That is a
 * property of the corpus: a new fixture that provokes an explained
 * difference should not fail, and a new *kind* of difference should.
 */
const EXPLAINED: { tool: string; path: string; why: string }[] = [
  ...['obsrv_audit', 'obsrv_lint', 'obsrv_inspect', 'obsrv_snap'].flatMap(tool => [
    { tool, path: 'tabId', why: 'headless has no tabs to name' },
    { tool, path: 'tabIndex', why: 'headless has no tabs to name' },
  ]),
  // The CLI's rule is that a key appears when the flag was given, so a
  // headless reply omits what nobody asked for. The app has no flags: it has
  // a state, and reports it. Same fact, two honest reporting rules.
  { tool: 'obsrv_inspect', path: 'textScale', why: 'headless reports the flag it was given; live reports the state in force' },
  // The throttle differs in when it appears, not in what it means: both report
  // the conditions in force, which after a refusal are the ones kept
  // (bug-throttle-field-means-two-things).
  { tool: 'obsrv_inspect', path: 'throttle', why: 'headless reports it only when the flag was given; both report the conditions in force' },
  { tool: 'obsrv_snap', path: 'textScale', why: 'as textScale' },
  { tool: 'obsrv_snap', path: 'throttle', why: 'as throttle' },
  // A live capture is of a window, and reports the window it captured.
  ...['orientation', 'screenShape', 'viewMode', 'panes', 'loading', 'onionSkin', 'navigated', 'width', 'height'].map(path => ({
    tool: 'obsrv_snap',
    path,
    why: 'window state; a headless render has no window',
  })),
  {
    tool: 'obsrv_snap',
    path: 'warnings[]',
    why: 'live only: the app can fail to confirm a navigation before a capture, which a headless render cannot',
  },
]

test('every surface difference is one with a written reason', () => {
  const explained = new Set(EXPLAINED.map(e => `${e.tool}\t${e.path}`))
  const unexplained = new Map<string, string[]>()
  for (const row of rows) {
    for (const d of row.divergences) {
      // Per-call temp files; the paths differ by construction.
      if (d.path.endsWith('pngPath')) continue
      const key = `${row.tool}\t${d.path}`
      if (explained.has(key)) continue
      if (!unexplained.has(key)) unexplained.set(key, [])
      unexplained.get(key)!.push(`${row.page}: headless=${JSON.stringify(d.headless)} live=${JSON.stringify(d.live)}`)
    }
  }
  const report = [...unexplained.entries()].map(([k, hits]) => `  ${k.replace('\t', ' ')}\n${hits.map(h => `    ${h}`).join('\n')}`).join('\n')
  expect(
    report,
    'The two surfaces differ somewhere nothing accounts for. Either close it, or add it to EXPLAINED with the reason — ' +
      `docs/research/2026-09-14-c4-field-sweep.md is where the reasoning goes.\n${report}`,
  ).toBe('')
})

/**
 * And the other direction, which is the one that fails quietly.
 *
 * The test above fails when a difference has no reason. Nothing failed when a
 * reason had no difference — so an entry meant either "these surfaces still
 * differ here, and here is why" or "they stopped differing and nobody removed
 * the row", with no way to tell them apart. Give that a few releases and the
 * table is a list of things that *used* to differ, read by the next person as
 * a list of things that do. The comment at the head of EXPLAINED already
 * claims it "cannot go stale without going red"; this is what makes that true.
 *
 * It also makes the table self-pruning: closing a divergence now forces its
 * own exemption out, rather than leaving it to be noticed.
 */
test('every written reason still describes a real difference', () => {
  // A tool that errored on every page produced no divergences, and calling its
  // exemptions stale would blame the table for the run. Only tools that
  // actually compared somewhere can testify about their own rows — which is
  // what `surface` is for: a row of zero divergences fits both "they agree"
  // and "only one surface answered", and the witness separates them.
  const answeredBoth = (r: Row): boolean =>
    r.headlessError === undefined &&
    r.liveError === undefined &&
    Object.keys((r.surface.headless ?? {}) as Record<string, unknown>).length > 0 &&
    Object.keys((r.surface.live ?? {}) as Record<string, unknown>).length > 0

  const toolsCompared = new Set(rows.filter(answeredBoth).map(r => r.tool))
  // A run where nothing compared cannot say anything about the table, and a
  // test that passes on no evidence is the defect this file exists to find.
  // Seen for real: run this spec with `-g` and the per-page tests above never
  // populate `rows`, so every row looks live and the check is vacuous.
  expect(
    toolsCompared.size,
    noEvidenceMessage('tool compared on any page', 'run the whole file rather than a filtered subset'),
  ).toBeGreaterThan(0)
  const seen = new Set<string>()
  for (const row of rows) {
    if (!answeredBoth(row)) continue
    for (const d of row.divergences) {
      // The same skip the test above applies, so a path it never counts as a
      // divergence is not then counted as a reason without one.
      if (d.path.endsWith('pngPath')) continue
      seen.add(`${row.tool}\t${d.path}`)
    }
  }

  const stale = EXPLAINED.filter(e => toolsCompared.has(e.tool) && !seen.has(`${e.tool}\t${e.path}`))
  const report = stale.map(e => `  ${e.tool} ${e.path}\n    reason on file: ${e.why}`).join('\n')
  expect(
    report,
    'A row in EXPLAINED excuses a difference the surfaces no longer have. If it was fixed, delete the row — ' +
      'leaving it turns the table into a record of the past that reads as a record of the present.' +
      `\n${report}`,
  ).toBe('')
})
