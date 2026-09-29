import { test, expect, type ElectronApplication } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'
import { request } from 'node:http'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { CONTROL_FILE_NAME, isDisabledStance, parseControlFile, type ControlInfo } from '../../src/shared/control'
import { launchApp, rendererWindow } from './launch'

/**
 * **The second forcing route for `bug-redirect-note-missing-not-late`, and the
 * one the first route's result asked for.**
 *
 * `redirect-forcing-route.spec.ts` forced six same-url starts and passed, while
 * the natural failure it was built from had six as well. Reading the two side by
 * side is what makes this file necessary: the failing pool held **two mirrored
 * starts among its six**, and the forced pool held none, because every start in
 * it came from `navigate`, which drives both panes and tells the bus not to
 * mirror. `startFor` skips mirrored starts (`targetSource.ts:1064`), so two pools
 * that both count six are **not the same pool** — the first route forced the
 * number and not the composition.
 *
 * So this forces the composition. The mirrored starts in the real failure come
 * from the bus mirroring the NATIVE pane's own redirect hop into the target, and
 * that is reproduced here by driving `native.load` directly, exactly as
 * `arrivals.spec.ts:139` does for the other direction.
 *
 * **What it asserts is the same property as the first route, and for the same
 * reason.** Not "the bug happens" — the register records 3 in 20 in CI against 0
 * in 40 locally, so no single run can assert that either way — but the property
 * that must hold on any build: **the start a commit is answered with belongs to
 * the navigation being answered**. The test owns the ground truth by recording
 * the instant before the redirect is triggered; a start from before it cannot be
 * that redirect's, however well its url matches.
 *
 * **The floors are the point of the file.** A route that cannot say whether it
 * built the pool it claims to have built is the first route again, one variable
 * over. Both the total and the mirrored count are asserted before the redirect,
 * with the numbers printed either way, so a run that merely failed to force the
 * condition says so instead of reporting a green.
 *
 * Desk-safe: nothing here shows or focuses a window, and both panes are the
 * offscreen ones the other control-server specs drive.
 */
const HAIRLINE = pathToFileURL(resolve(__dirname, '../fixtures/hairline.html')).href
const TALL = pathToFileURL(resolve(__dirname, '../fixtures/tall.html')).href
const REDIRECT = pathToFileURL(resolve(__dirname, '../fixtures/redirect.html')).href

/** The failing pool's shape, from the register's table: six starts for the
 *  address the redirect lands on, of which two were the bus's own. */
const FORCE_STARTS = 6
const FORCE_MIRRORED = 2

type Start = { at: number; url: string; byDocument: boolean; mirrored: boolean; fromBusDocument?: boolean }

let app: ElectronApplication
let info: ControlInfo

interface Reply {
  status: number
  body: Record<string, unknown>
}

function call(command: string, payload?: Record<string, unknown>): Promise<Reply> {
  return new Promise((done, fail) => {
    const data = JSON.stringify({ command, token: info.token, ...(payload ? { payload } : {}) })
    const req = request(
      { host: '127.0.0.1', port: info.port, method: 'POST', path: '/', headers: { 'content-type': 'application/json' } },
      res => {
        let text = ''
        res.on('data', d => (text += String(d)))
        res.on('end', () => done({ status: res.statusCode ?? 0, body: JSON.parse(text || '{}') as Record<string, unknown> }))
      },
    )
    req.on('error', fail)
    req.end(data)
  })
}

/** The starts the app has recorded, read from the same field `startFor` reads.
 *  Private to TypeScript only; at runtime it is a field on the object the specs
 *  already reach through `__obsrv.target`. */
const startsNow = (): Promise<Start[]> =>
  app.evaluate(() => {
    const t = (globalThis as unknown as { __obsrv?: { target?: { starts?: Start[] } } }).__obsrv?.target
    return Array.isArray(t?.starts) ? [...t.starts] : []
  })

const targetUrl = (): Promise<string> =>
  app.evaluate(() => (globalThis as unknown as { __obsrv: { target: { webContents: { getURL(): string } } } }).__obsrv.target.webContents.getURL())

const nativeUrl = (): Promise<string> =>
  app.evaluate(() => (globalThis as unknown as { __obsrv: { native: { webContents: { getURL(): string } } } }).__obsrv.native.webContents.getURL())

/** Drives the NATIVE pane only, which is how a mirrored start is produced: the
 *  bus mirrors whatever that pane commits into the target, and those commits are
 *  the ones `startFor` skips. */
const loadNative = (url: string): Promise<void> =>
  app.evaluate(async (_e, u: string) => {
    await (globalThis as unknown as { __obsrv: { native: { load(input: string): Promise<string> } } }).__obsrv.native.load(u)
  }, url)

const shape = (starts: Start[], url: string): { total: number; mirrored: number; byDocument: number } => ({
  total: starts.filter(s => s.url === url).length,
  mirrored: starts.filter(s => s.url === url && s.mirrored).length,
  byDocument: starts.filter(s => s.url === url && s.byDocument).length,
})

test.beforeAll(async () => {
  app = await launchApp([], { OBSRV_AGENT_CONTROL: '1' })
  await rendererWindow(app)
  const userData = await app.evaluate(({ app: a }) => a.getPath('userData'))
  const controlFile = join(userData, CONTROL_FILE_NAME)
  await expect.poll(() => existsSync(controlFile)).toBe(true)
  const parsed = parseControlFile(readFileSync(controlFile, 'utf8'))
  if (!parsed) throw new Error(`the control file at ${controlFile} did not parse`)
  if (isDisabledStance(parsed)) throw new Error(`the control file at ${controlFile} names no port: agent control is off`)
  info = parsed
})

test.afterAll(async () => {
  await app?.close()
})

test('a pool holding the bus’s own starts as well as the page’s still answers a redirect with that redirect’s start', async () => {
  // Build the pool. Each pass leaves the target somewhere else (`tall.html`) and
  // then drives the NATIVE pane through `redirect.html`, whose two hops the bus
  // mirrors into the target — the second of them a load of the address the
  // redirect under test will land on, recorded `mirrored: true`. The
  // `navigate` in between contributes the non-mirrored half of the mix.
  for (let i = 0; i < FORCE_STARTS; i++) {
    await call('navigate', { url: i % 2 === 0 ? TALL : HAIRLINE })
    await loadNative(REDIRECT)
    await expect.poll(nativeUrl, { timeout: 10_000 }).toBe(HAIRLINE)
  }

  const before = await startsNow()
  const pool = shape(before, HAIRLINE)
  console.log(`[redirect-mirrored-pool] pool for hairline: ${JSON.stringify(pool)}`)

  // **The forcing floors.** The first route's whole result was that six starts
  // are not one condition, so a run that does not build the composition must
  // fail here rather than pass on the assertion below.
  expect(pool.total, `only ${pool.total} starts for hairline: the pool the register's table names was not forced`).toBeGreaterThanOrEqual(FORCE_STARTS)
  expect(
    pool.mirrored,
    `only ${pool.mirrored} of the ${pool.total} starts were the bus's: this is the first route's pool again, not the failing one`,
  ).toBeGreaterThanOrEqual(FORCE_MIRRORED)

  // Ground truth the test owns: nothing recorded before this instant belongs to
  // the redirect that is about to happen.
  const boundary = Date.now()
  await call('navigate', { url: REDIRECT })
  await expect.poll(targetUrl, { timeout: 10_000 }).toBe(HAIRLINE)

  const after = await startsNow()
  // The same find `startFor` does, on the same data.
  const matched = [...after].reverse().find(s => s.url === HAIRLINE && !s.mirrored)

  console.log(
    `[redirect-mirrored-pool] after: ${JSON.stringify(shape(after, HAIRLINE))} boundary=${boundary} ` +
      `matched=${matched ? `at=${matched.at} byDocument=${matched.byDocument} fromBusDocument=${String(matched.fromBusDocument)} age=${boundary - matched.at}ms` : 'none'}`,
  )

  expect(matched, 'no non-mirrored start was found for the address the redirect landed on').toBeDefined()
  expect(
    matched!.at,
    `the commit was answered with a start from ${boundary - matched!.at} ms before the redirect was triggered — an earlier visit to the same address, chosen out of a pool of ${pool.total} where ${pool.mirrored} were the bus's`,
  ).toBeGreaterThanOrEqual(boundary)
})
