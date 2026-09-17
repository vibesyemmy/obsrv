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
/**
 * Playwright's per-test default is 30 s, and the first live test pays for an
 * Electron boot before it reads anything: on run 35203626404 it timed out at
 * 30 s ("MCP error -32000: Connection closed") and passed on the retry, while
 * every per-call budget in this file is already 150 s. The MCP specs carry
 * 180 s for the same reason (mcp.spec.ts, mcp-live.spec.ts), so this file does
 * too rather than leaving a boot to race a budget it was never sized for.
 */
test.describe.configure({ timeout: 180_000 })

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

/**
 * `walkNothingNote`'s opening, on any page. The shell below used to fire its
 * shadow-root tail ("the page has 1 open shadow root, which the walk does not
 * enter"). The walk enters open roots now, so that tail is reachable only from
 * an app older than the change, which `tests/unit/walkCoverage.test.ts` guards.
 */
const NOTHING_TO_SCROLL = 'so the walk had nothing to scroll'

/** `cli/walk.ts:125` and `mcp/walk.ts:143` — the budget sentence. The CLI rounds its seconds from what is left of its own deadline, so the shape is fixed and the number is not. */
const BUDGET_SENTENCE =
  /^the walk stopped after (\d+) screenfuls at its \d+(\.\d)? s budget without reaching the end of the page; the measurement covers the whole page regardless\.$/

/** `cli/walk.ts:179` — a step the page never answered, carrying `walkTimeoutNote`'s own sentence inside it. */
const CUT_SHORT_HEADLESS =
  /^the walk was cut short after (\d+) screenfuls? \(the page did not answer a scroll within \d+(\.\d)? s \(its main thread was busy or blocked\)\); measured after a partial walk\.$/

/** `mcp/walk.ts:184` — the live walk's scroll that came back unconfirmed. */
const NOT_CONFIRMED_LIVE = 'the page did not confirm a scroll during the walk; the walk stopped there.'

/** `shared/walkCoverage.ts` — `walkDialogNote`'s panel wording, which an app shell's walk earns. */
const PANEL_NOT_THE_PAGE =
  "the walk scrolled a panel on the page, not the page itself: this page hides the document's overflow and the only scroller the walk found was a panel within it"


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
    // The sentence first, as in the locks arm above: it is the thing under
    // test, and a count asserted ahead of it can fail the test before the
    // sentence is ever read.
    expect(said(m), JSON.stringify(said(m))).toContain(COULD_NOT_MOVE_DIALOG)
    expect(m.walked?.screenfuls, JSON.stringify(m.walked)).toBe(0)
  })

  test('an app shell whose only content is behind one open root: the walk scrolls the feed, and says it was a panel', async () => {
    const m = await headless('shell-with-one-root.html')
    // The sentence first, as in the locks arm above: here its absence, and
    // then the sentence that replaces it. A walk that moves a component's feed
    // has walked a panel, not the page, and the reader is told which — the
    // same words a light-DOM app shell gets (Wren's read of #293: this test
    // never read what the walk said).
    expect(said(m).join(' '), JSON.stringify(said(m))).not.toContain(NOTHING_TO_SCROLL)
    expect(said(m).join(' '), JSON.stringify(said(m))).toContain(PANEL_NOT_THE_PAGE)
    expect(m.walked?.screenfuls, JSON.stringify(m.walked)).toBeGreaterThan(0)
  })

  test('a page taller than the budget: the walk says where it stopped, and the count in the sentence is the count in the reply', async () => {
    // 150 screenfuls at 150 ms of dwell each is well past the 15 s budget. The
    // seconds in the sentence are what the CLI had left of its own deadline
    // rather than a constant, so the shape is asserted and the count is tied
    // to `walked.screenfuls`, which is the field a reader compares it against.
    const m = await headless('taller-than-the-walk-budget.html')
    // RECORDED, not asserted: every sentence this walk produced. A budget-ended
    // walk falls straight through to `backToTop` with nothing left, so the
    // return-to-top note may be here too — carrying `walkTimeoutNote`'s "did
    // not answer a scroll within 15 s (its main thread was busy or blocked)"
    // about a page that answered every step (Kenya's reading, Wren's code
    // check). This page's thread is free, so whatever appears beside the budget
    // sentence here is the answer, and it costs a run nobody has to schedule.
    console.log(`budget-ended walk said: ${JSON.stringify(said(m))}`)
    const budget = said(m).find(w => w.includes('budget without reaching the end of the page'))
    expect(budget, JSON.stringify(said(m))).toBeTruthy()
    expect(budget).toMatch(BUDGET_SENTENCE)
    expect(BUDGET_SENTENCE.exec(budget!)?.[1]).toBe(String(m.walked?.screenfuls))
    expect(m.walked?.atEnd, JSON.stringify(m.walked)).toBe(false)
    // It really did walk: a budget that stopped it at zero would be a
    // different failure wearing this sentence.
    expect(m.walked?.screenfuls, JSON.stringify(m.walked)).toBeGreaterThan(3)
  })

  // LAST in this describe: the page holds its main thread for 25 s after the
  // first scroll, and the CLI process it holds is this test's own.
  test('a page that stops answering once scrolled: the walk says it was cut short, and how far it got', async () => {
    const m = await headless('blocks-on-scroll.html')
    const cut = said(m).find(w => w.includes('cut short'))
    expect(cut, JSON.stringify(said(m))).toBeTruthy()
    expect(cut).toMatch(CUT_SHORT_HEADLESS)
    expect(CUT_SHORT_HEADLESS.exec(cut!)?.[1]).toBe(String(m.walked?.screenfuls))
    // One screenful, because the hold starts on the first scroll EVENT: the
    // step that caused it is answered, and the one after it is not.
    expect(m.walked?.screenfuls, JSON.stringify(m.walked)).toBe(1)
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

  /** A live audit of a URL, for the one fixture that takes a query. */
  const liveUrl = async (url: string): Promise<Reply> => {
    const r = (await client.callTool(
      { name: 'obsrv_audit', arguments: { url, mode: 'live', groupsOnly: true } },
      undefined,
      { timeout: 150_000 },
    )) as CallToolResult
    expect(r.isError, JSON.stringify(r.content).slice(0, 300)).toBeFalsy()
    return (r.structuredContent ?? {}) as Reply
  }

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
    // The sentence first, as in the locks arm above: it is the thing under
    // test, and a count asserted ahead of it can fail the test before the
    // sentence is ever read.
    expect(said(m), JSON.stringify(said(m))).toContain(COULD_NOT_MOVE_DIALOG)
    expect(m.walked?.screenfuls, JSON.stringify(m.walked)).toBe(0)
  })

  test('an app shell whose only content is behind one open root: the live walk scrolls the feed, and says it was a panel', async () => {
    const m = await live('shell-with-one-root.html')
    expect(said(m).join(' '), JSON.stringify(said(m))).not.toContain(NOTHING_TO_SCROLL)
    expect(said(m).join(' '), JSON.stringify(said(m))).toContain(PANEL_NOT_THE_PAGE)
    expect(m.walked?.screenfuls, JSON.stringify(m.walked)).toBeGreaterThan(0)
  })

  test('a page taller than the budget: the live walk says where it stopped too', async () => {
    const m = await live('taller-than-the-walk-budget.html')
    // The same recording on the live surface, where the scroll carries no
    // budget of its own and so has no number to misreport: the pair is what
    // says whether this is headless-only.
    console.log(`budget-ended live walk said: ${JSON.stringify(said(m))}`)
    const budget = said(m).find(w => w.includes('budget without reaching the end of the page'))
    expect(budget, JSON.stringify(said(m))).toBeTruthy()
    expect(budget).toMatch(BUDGET_SENTENCE)
    expect(BUDGET_SENTENCE.exec(budget!)?.[1]).toBe(String(m.walked?.screenfuls))
    expect(m.walked?.atEnd, JSON.stringify(m.walked)).toBe(false)
    expect(m.walked?.screenfuls, JSON.stringify(m.walked)).toBeGreaterThan(3)
  })

  // LAST in the file: this page holds the app's target thread for 25 s, and
  // the app is shared by every test above it.
  test('a page that stops answering once scrolled: the live walk says the scroll was never confirmed', async () => {
    // A 5 s hold, not the fixture's default 25 s: the live audit measures the
    // page AFTER the walk and needs the same main thread, so a hold longer than
    // its own 20 s budget refuses the whole audit and the walk's sentence never
    // reaches a reply (measured, probe 35229526006). 5 s is longer than the 1 s
    // confirm window and short enough to be measured afterwards.
    const m = await liveUrl(`${fixture('blocks-on-scroll.html')}?hold=5000`)
    // The same page, met differently: the live scroll goes through the control
    // server, which answers `scrolled: null` after its 1 s confirm window
    // rather than throwing, so the walk stops with this sentence instead of
    // the headless one.
    expect(said(m), JSON.stringify(said(m))).toContain(NOT_CONFIRMED_LIVE)
    expect(m.walked?.screenfuls, JSON.stringify(m.walked)).toBe(1)
  })
})
