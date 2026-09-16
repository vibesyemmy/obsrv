import { expect, test, type ElectronApplication } from '@playwright/test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { CONTROL_FILE_NAME } from '../../src/shared/control'
import { launchApp } from './launch'

/**
 * THROWAWAY — `bug-walk-coverage-diverges`, on `probe/walk-visible`. Never merged.
 *
 * The card's one open hypothesis: both walks take `atEnd` from the step that
 * scrolled, before their dwell, and `app-shell-grows.html` grows from a
 * `scroll` handler that runs at the next frame. **A visible window renders
 * every frame; a hidden one may not.** So a reply landing after that frame sees
 * the growth and walks on (8 screenfuls); one landing before stops at 3.
 *
 * The card says this needs a visible app and lists two unblockers, neither
 * available. The third is `OBSRV_TEST_TAKES_THE_DESK=1` (#114) **on CI**, where
 * there is no desk to take — which is what this runs.
 *
 * Arms are pre-registered on the card. Read arm C first: if the flag changes
 * nothing observable on a runner, arm B is UNMEASURED rather than negative.
 */
const ROOT = resolve(__dirname, '../..')
const MCP_BIN = resolve(ROOT, 'bin/obsrv-mcp.js')
const FIXTURE = pathToFileURL(resolve(__dirname, '../fixtures/app-shell-grows.html')).href
const PRESET = 'laptop-768'
const TAKES_DESK = process.env['OBSRV_TEST_TAKES_THE_DESK'] === '1'

test.describe.configure({ mode: 'serial', timeout: 300_000 })

let app: ElectronApplication
let client: Client

test.beforeAll(async () => {
  app = await launchApp([], { OBSRV_AGENT_CONTROL: '1' })
  const userData = await app.evaluate(({ app: a }) => a.getPath('userData'))
  const env = Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined))
  client = new Client({ name: 'walk-visible-probe', version: '0.0.0' })
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [MCP_BIN],
      cwd: ROOT,
      env: { ...env, OBSRV_CONTROL_FILE: join(userData, CONTROL_FILE_NAME) },
    }),
  )
  await client.listTools()
  // Live ignores `preset`, so the screen is set on the app first — the trap
  // Henry's first pass fell into, which made the app's own 1920x1080 look
  // like a divergence.
  await client.callTool({ name: 'obsrv_drive', arguments: { preset: PRESET } }, undefined, { timeout: 150_000 })
})

test.afterAll(async () => {
  await client?.close()
  await app?.close()
})

/**
 * ARM C, and it runs first on purpose. If the flag changes nothing a runner can
 * see, then arm B is not evidence about frame timing — it is a measurement with
 * no instrument, and the run must say so rather than report "the hypothesis is
 * dead".
 *
 * **Its own limit, stated:** this checks the flag TOOK EFFECT (the window is
 * focusable and shown as a user's app would be). It does NOT prove the window
 * renders at a different frame rate, which is what the hypothesis is actually
 * about. A shown-but-never-composited window on a headless runner could satisfy
 * this and still render like a hidden one.
 */
test('ARM C: does the flag change anything this runner can see?', async () => {
  // The MAIN window by name, not getAllWindows()[0] — the app also creates an
  // overlay window, so the index is a guess. The first run of this probe took
  // that guess and reported visible:false with the flag ON and off alike,
  // which made arm B unmeasurable for a reason that was mine rather than the
  // runner's.
  // BrowserWindow arrives as the destructured argument; `require` is not
  // defined in this scope, which is how the second dispatch died.
  const state = await app.evaluate(({ BrowserWindow }) => {
    const w = (globalThis as { __obsrv?: { win?: Electron.BrowserWindow } }).__obsrv?.win
    return w === undefined
      ? { found: false, count: BrowserWindow.getAllWindows().length }
      : { found: true, visible: w.isVisible(), focusable: w.isFocusable(), focused: w.isFocused(), count: BrowserWindow.getAllWindows().length }
  })
  console.log(`  ARM C  flag=${TAKES_DESK ? 'ON' : 'off'}  window=${JSON.stringify(state)}`)
  expect(state.found, 'no main window to judge; arm B would be void').toBe(true)
  // Recorded, not asserted: the comparison is between the two runs, and a
  // single run cannot make it. The dispatch runs both and the two lines are
  // read together.
})

const walkOf = async (mode: 'headless' | 'live'): Promise<void> => {
  const r = (await client.callTool(
    { name: 'obsrv_audit', arguments: { url: FIXTURE, mode, ...(mode === 'headless' ? { preset: PRESET } : {}), groupsOnly: true } },
    undefined,
    { timeout: 150_000 },
  )) as CallToolResult
  const s = (r.structuredContent ?? {}) as Record<string, unknown>
  const walked = s['walked'] as { screenfuls?: number; atEnd?: boolean; ms?: number } | undefined
  const said = [...((s['notes'] as string[] | undefined) ?? []), ...((s['warnings'] as string[] | undefined) ?? [])]
  const coverage = said.find(w => /screenfuls/.test(w))
  console.log(
    `  ${mode.padEnd(8)} flag=${TAKES_DESK ? 'ON' : 'off'}  screenfuls=${walked?.screenfuls}  atEnd=${walked?.atEnd}  ` +
      `pageHeight=${String(s['pageHeight'])}  walkMs=${walked?.ms}  note=${coverage === undefined ? 'SILENT' : 'FIRES'}`,
  )
  if (coverage !== undefined) console.log(`      ${coverage.slice(0, 160)}`)
  expect(r.isError, JSON.stringify(r.content).slice(0, 300)).toBeFalsy()
}

test('ARM A/B: the two walks on a growing page', async () => {
  await walkOf('headless')
  await walkOf('live')
})
