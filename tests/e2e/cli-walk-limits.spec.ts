import { expect, test, type ElectronApplication } from '@playwright/test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { spawn } from 'node:child_process'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { CONTROL_FILE_NAME } from '../../src/shared/control'
import { launchApp } from './launch'

/**
 * c5, the walk-limits cluster, batch 1: four of the thirteen sentences in
 * `cli/walk.ts`, `mcp/walk.ts` and `shared/walkCoverage.ts` that nothing had
 * been seen to say (`docs/note-inventory.md`). Measured first (run
 * 35200677199, every existing walk fixture, headless and live): the existing
 * fixtures fire these sentences' already-counted siblings and none of these,
 * so each has a fixture built for its one branch, verified in a real Chromium
 * before the test was written.
 *
 * Whole sentences, not phrases — a phrase match is how a note gets reworded
 * into meaninglessness while its test stays green (Henry, #393). The number in
 * each sentence's story is tied to the field beside it.
 *
 * The headless and live mirrors of one sentence share a fixture and sit in the
 * same file: a red on one and not the other is itself a finding.
 *
 * Spawns the CLI's Electron for the headless half, so CI-only.
 */
const ROOT = resolve(__dirname, '../..')
const BIN = resolve(ROOT, 'bin/obsrv.js')
const MCP_BIN = resolve(ROOT, 'bin/obsrv-mcp.js')
const PRESET = 'laptop-768'
const fixture = (name: string): string => pathToFileURL(resolve(__dirname, `../fixtures/${name}`)).href

// --- the sentences, verbatim ----------------------------------------------

/** `cli/walk.ts:165` — a `next` that lands where the page already was, before its end. */
const STOPPED_MOVING_HEADLESS =
  'the page stopped moving before the end of the walk (a locked scroll, or a page that scrolls by other means); measured from where it stood.'

/** `mcp/walk.ts:197` — the live mirror, which names the modal-or-menu case the live app can meet. */
const STOPPED_MOVING_LIVE =
  'the page stopped moving before the end of the walk (a locked scroll: a modal or a menu holding the page, or a page that scrolls by other means); measured from where it stood.'

/** `shared/walkCoverage.ts:245` — `walkDialogNote` at zero screenfuls, both surfaces. */
const COULD_NOT_MOVE_DIALOG =
  "the walk could not move the page or the dialog over it: this page hides the document's overflow while a dialog is open, and neither moved — the figures are of the first screen, and anything below it was never brought into view"

/** `shared/walkCoverage.ts:168` — `walkNothingNote`'s shadow-root tail, both surfaces. */
const ONE_OPEN_ROOT =
  "this page hides the document's overflow and has no scrollable container in its light DOM, so the walk had nothing to scroll: the page has 1 open shadow root, which the walk does not enter, and nothing in the light DOM scrolls, and the figures are of the page as it first shows"

// --- helpers --------------------------------------------------------------

function runCli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [BIN, ...args], { cwd: ROOT })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', d => (stdout += d))
    child.stderr.on('data', d => (stderr += d))
    child.on('error', fail)
    child.on('close', code => done({ code: code ?? -1, stdout, stderr }))
  })
}

type Reply = { walked?: { screenfuls: number; atEnd: boolean }; warnings?: string[]; notes?: string[] }

const headless = async (name: string): Promise<Reply> => {
  const r = await runCli(['audit', fixture(name), '--preset', PRESET])
  expect(r.code, r.stderr).toBe(0)
  return JSON.parse(r.stdout) as Reply
}

/** Every sentence a reply carries, wherever it put it, so a move between the two arrays is not a silent miss. */
const said = (m: Reply): string[] => [...(m.warnings ?? []), ...(m.notes ?? [])]

// --- headless: cli/walk.ts + shared -----------------------------------------

test.describe('headless walk limits (cli/walk.ts and shared)', () => {
  test('a page that locks its scroll mid-walk: the walk says it stopped moving', async () => {
    const m = await headless('locks-mid-walk.html')
    // The sentence first: it is the thing under test, and the first run of
    // this test failed at the count below before ever reaching it.
    expect(said(m), JSON.stringify(said(m))).toContain(STOPPED_MOVING_HEADLESS)
    // Three, not two, and the reason is the fixture's lock landing a step late:
    // `overflow: hidden` does not block a scripted `scrollTo`, so the step
    // after the lock still reads its target synchronously, the pin listener
    // resets the page afterwards, and the FOLLOWING step lands where the
    // previous read did. A first cut predicted 2 from a Chromium simulation
    // that awaited a frame between scroll and readback — a frame the walk does
    // not have. The page is 5906 px tall, so this is the not-at-end branch.
    expect(m.walked?.screenfuls, JSON.stringify(m.walked)).toBe(3)
    expect(m.walked?.atEnd).toBe(false)
  })

  test('a locked page whose dialog scrolls only sideways: the walk could move neither', async () => {
    const m = await headless('dialog-sideways.html')
    expect(m.walked?.screenfuls, JSON.stringify(m.walked)).toBe(0)
    expect(said(m), JSON.stringify(said(m))).toContain(COULD_NOT_MOVE_DIALOG)
  })

  test('an app shell whose only content is behind one open root: the note names the root', async () => {
    const m = await headless('shell-with-one-root.html')
    expect(m.walked?.screenfuls, JSON.stringify(m.walked)).toBe(0)
    expect(said(m), JSON.stringify(said(m))).toContain(ONE_OPEN_ROOT)
  })
})

// --- live: mcp/walk.ts + shared ---------------------------------------------

let app: ElectronApplication
let client: Client

test.describe('live walk limits (mcp/walk.ts and shared)', () => {
  // NOT serial. Each live test navigates the app to its own fixture and reads
  // one reply, so none depends on the one before it, and a red on one must not
  // cost the others their verdict. The first run of this file was serial by
  // reflex: one red on the locks fixture skipped the other two live tests, so
  // their live mirrors went unread for a whole run. The one app and one MCP
  // client are shared through beforeAll, which is fine — Playwright runs a
  // describe's tests in order on one worker either way (playwright.config sets
  // workers: 1 unconditionally); serial only adds "stop at the first red".

  test.beforeAll(async () => {
    app = await launchApp([], { OBSRV_AGENT_CONTROL: '1' })
    const userData = await app.evaluate(({ app: a }) => a.getPath('userData'))
    const env = Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined))
    client = new Client({ name: 'walk-limits', version: '0.0.0' })
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [MCP_BIN],
        cwd: ROOT,
        env: { ...env, OBSRV_CONTROL_FILE: join(userData, CONTROL_FILE_NAME) },
      }),
    )
    await client.listTools()
    // Live ignores `preset`; the screen is set on the app first.
    await client.callTool({ name: 'obsrv_drive', arguments: { preset: PRESET } }, undefined, { timeout: 150_000 })
  })

  test.afterAll(async () => {
    await client?.close()
    await app?.close()
  })

  const live = async (name: string): Promise<Reply> => {
    const r = (await client.callTool(
      { name: 'obsrv_audit', arguments: { url: fixture(name), mode: 'live', groupsOnly: true } },
      undefined,
      { timeout: 150_000 },
    )) as CallToolResult
    expect(r.isError, JSON.stringify(r.content).slice(0, 300)).toBeFalsy()
    return (r.structuredContent ?? {}) as Reply
  }

  test('a page that locks its scroll mid-walk: the live walk says it stopped moving', async () => {
    const m = await live('locks-mid-walk.html')
    expect(said(m), JSON.stringify(said(m))).toContain(STOPPED_MOVING_LIVE)
    // Same count as headless, for the same reason (see above): the live path
    // scrolls with the same instant `scrollTo` and reads back in the same task.
    expect(m.walked?.screenfuls, JSON.stringify(m.walked)).toBe(3)
    expect(m.walked?.atEnd).toBe(false)
  })

  test('a locked page whose dialog scrolls only sideways: the live walk could move neither', async () => {
    const m = await live('dialog-sideways.html')
    expect(m.walked?.screenfuls, JSON.stringify(m.walked)).toBe(0)
    expect(said(m), JSON.stringify(said(m))).toContain(COULD_NOT_MOVE_DIALOG)
  })

  test('an app shell whose only content is behind one open root: the live note names the root', async () => {
    const m = await live('shell-with-one-root.html')
    expect(m.walked?.screenfuls, JSON.stringify(m.walked)).toBe(0)
    expect(said(m), JSON.stringify(said(m))).toContain(ONE_OPEN_ROOT)
  })
})
