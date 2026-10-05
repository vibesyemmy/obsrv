import { test, expect, type ElectronApplication } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'
import { request } from 'node:http'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { CONTROL_FILE_NAME, isDisabledStance, parseControlFile, type ControlInfo } from '../../src/shared/control'
import { launchApp, rendererWindow } from './launch'

/**
 * **A page's own redirect, after a pool of starts that includes the bus's, is still reported as the page's.**
 *
 * This began as the second forcing route for `bug-redirect-note-missing-not-late`, and the one the first
 * route's result asked for: the failing pool held **two mirrored starts among its six**, and a pool built only
 * from `navigate` held none, so two pools that both count six were not the same pool. This forces the
 * COMPOSITION. The mirrored starts come from the bus mirroring the NATIVE pane's own redirect hops into the
 * target, reproduced by driving `native.load` directly, as `arrivals.spec.ts` does for the other direction.
 *
 * **What it asserts changed with `#558`, and this file says so rather than keep its old claim.** It used to
 * compute `[...starts].reverse().find(s => s.url === HAIRLINE && !s.mirrored)`, a COPY of the `startFor` rule
 * that `#558` deleted, and assert a property of the recorded trace. That said nothing about which start the
 * product answered a commit with, so the name ("still answers a redirect with that redirect's start") claimed
 * more than the check did (`chore-e2e-specs-copy-the-deleted-startfor`). A start is now answered once, by its
 * commit, by `did-fail-load` or by `did-stop-loading` (`answeringStart`), and the product records which kind of
 * start each commit answered in `commitTrace()`. **So this reads THAT**: the redirect's commit must not be
 * stamped the bus's, and must have answered the page's own start (`mirrorTerms.answeredOwnStart`). It also
 * asserts one recorded fact, with no rule copied from the product: a document-initiated, non-mirrored start of
 * the address exists at or after the instant the redirect was triggered.
 *
 * **Where this can catch what the model cannot.** `tests/unit/targetSourceMirror.test.ts` asserts the same
 * property through the real class with events it emits itself. Here the events are a real Chromium's, and a
 * pool of mixed starts is where an unanswered stale start would show up: a commit answered with the wrong
 * start is stamped from that start's flags, so the redirect would read as the bus's.
 *
 * **The wait is for what the redirect PRODUCES, not for a URL the target may already hold.** The pool loop
 * leaves the target at `hairline`, so waiting for the target URL to equal `hairline` can be satisfied at once,
 * before the redirect has started, and the trace is then read with no start for it yet. That was the one
 * first-attempt failure of this test (run `37293811824`: the pool shape before and after the redirect was
 * identical). `sync.spec.ts` records the same mistake and the same repair ("WAIT FOR WHAT STEP 2 PRODUCES").
 *
 * **The boundary is taken only once the pool has settled.** An odd last pass navigates the target to `hairline`
 * itself, so a poll on that URL passes at once while the bus is still mirroring the native pane's two hops
 * into the target. In 1 of 30 loaded local runs a mirrored commit of `hairline` landed after the boundary and
 * was read as the redirect's (the pool then held 8 starts for `hairline`; after settling it holds 11). The
 * test now waits for the target to be at `hairline`, not loading, and quiet for `QUIET_MS`, and it reads the
 * redirect's own landing as the `hairline` commit that FOLLOWS the redirect page's own commit. If something
 * else commits first, the failure says the pool was not settled rather than blaming the product.
 *
 * **It may pass here and fail in CI.** The register records 3 in 20 in CI against 0 in 40 locally for the
 * original bug, so no single run can assert that either way; this asserts the property that must hold on any
 * build. **The floors say the pool was built, and no more than that now.** A route that cannot say whether it
 * built the pool it claims to have built is the first route again, one variable over, so the total and the
 * mirrored count are asserted before the redirect, with the numbers printed either way. **Since `#558` marks
 * every start answered at `did-stop-loading`, the DEPTH of the pool no longer decides which start a commit
 * answers; the floors now guard against a vacuous run (no mirrored starts were ever produced), not against a
 * depth effect.**
 *
 * **What it catches depends on the pool the run happens to build.** With the `did-stop-loading` retire-all
 * removed it failed in most runs (10/10, 17/20 and 9/13 in three sets), and the passes were runs whose pool
 * left no stale unanswered start for the redirect to be paired with (in one set, every pass had no
 * document-initiated start of `hairline` and every failure had one or more). Answering the NEWEST unanswered
 * start instead of the oldest was caught in 2 of 3 runs. **Skipping mirrored starts (the pre-`#558` rule,
 * oldest-first with consumption) is not seen by this spec, by the one it replaced, or by
 * `tests/unit/targetSourceMirror.test.ts`**, and nobody has yet built the input where the bus's start precedes
 * the page's to say whether that rule is equivalent on every reachable input or a gap.
 *
 * Desk-safe: nothing here shows or focuses a window, and both panes are the offscreen ones the other
 * control-server specs drive.
 */
const HAIRLINE = pathToFileURL(resolve(__dirname, '../fixtures/hairline.html')).href
const TALL = pathToFileURL(resolve(__dirname, '../fixtures/tall.html')).href
const REDIRECT = pathToFileURL(resolve(__dirname, '../fixtures/redirect.html')).href

/** The failing pool's shape, from the register's table: six starts for the
 *  address the redirect lands on, of which two were the bus's own. */
const FORCE_STARTS = 6
const FORCE_MIRRORED = 2
/** How long the target must have recorded nothing, and not be loading, before the redirect is triggered. */
const QUIET_MS = 750

type Start = { at: number; url: string; byDocument: boolean; mirrored: boolean; fromBusDocument?: boolean }
/** The terms `commitTrace()` records per commit; `answeredOwnStart` is the one this spec reads. */
type Terms = { byDocument: boolean; viaMirrorUrl: boolean; viaNotByDocument: boolean; viaBusDocument: boolean; answeredOwnStart?: boolean }
type Commit = { at: number; url: string; kind: string; said: boolean; mirroring?: boolean; mirrorTerms?: Terms }

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

/** The starts the app has recorded. Private to TypeScript only; at runtime it is a
 *  field on the object the specs already reach through `__obsrv.target`. */
const startsNow = (): Promise<Start[]> =>
  app.evaluate(() => {
    const t = (globalThis as unknown as { __obsrv?: { target?: { starts?: Start[] } } }).__obsrv?.target
    return Array.isArray(t?.starts) ? [...t.starts] : []
  })

/** Every commit the target has recorded (the trace keeps the last 64), as `commitTrace()` reports it. */
const commitsNow = (): Promise<Commit[]> =>
  app.evaluate(() => {
    const t = (globalThis as unknown as { __obsrv?: { target?: { commitTrace?: () => unknown[] } } }).__obsrv?.target
    return (t?.commitTrace?.() ?? []) as Commit[]
  })

const targetUrl = (): Promise<string> =>
  app.evaluate(() => (globalThis as unknown as { __obsrv: { target: { webContents: { getURL(): string } } } }).__obsrv.target.webContents.getURL())

const nativeUrl = (): Promise<string> =>
  app.evaluate(() => (globalThis as unknown as { __obsrv: { native: { webContents: { getURL(): string } } } }).__obsrv.native.webContents.getURL())

/** Drives the NATIVE pane only, which is how a mirrored start is produced: the
 *  bus mirrors whatever that pane commits into the target. */
const loadNative = (url: string): Promise<void> =>
  app.evaluate(async (_e, u: string) => {
    await (globalThis as unknown as { __obsrv: { native: { load(input: string): Promise<string> } } }).__obsrv.native.load(u)
  }, url)

const shape = (starts: Start[], url: string): { total: number; mirrored: number; byDocument: number } => ({
  total: starts.filter(s => s.url === url).length,
  mirrored: starts.filter(s => s.url === url && s.mirrored).length,
  byDocument: starts.filter(s => s.url === url && s.byDocument).length,
})

/** The target's own loading state: false once nothing it started is still in flight. */
const targetLoading = (): Promise<boolean> =>
  app.evaluate(() => (globalThis as unknown as { __obsrv: { target: { webContents: { isLoading(): boolean } } } }).__obsrv.target.webContents.isLoading())

/** The newest instant at which the target recorded a start or a commit (0 when it has recorded none). */
const lastActivity = async (): Promise<number> =>
  Math.max(0, ...(await startsNow()).map(s => s.at), ...(await commitsNow()).map(c => c.at))

/** What the redirect produced, read off the commits recorded at or after `boundary`: the commit of `redirect`
 *  itself, then the commit of `hairline` that follows it, which is the redirect's own landing. A `hairline`
 *  commit that comes BEFORE `redirect` committed cannot be the redirect's, so it is not looked at here. */
const redirectRun = (commits: Commit[], boundary: number): { first?: Commit; redirect?: Commit; landed?: Commit } => {
  const since = commits.filter(c => c.kind === 'did-navigate' && c.at >= boundary)
  const ri = since.findIndex(c => c.url === REDIRECT)
  return { first: since[0], redirect: since[ri], landed: ri < 0 ? undefined : since.slice(ri + 1).find(c => c.url === HAIRLINE) }
}

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

test('a page’s own redirect, after a pool of starts that includes the bus’s, is still reported as the page’s', async () => {
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
  // **The pool is BUILT when the bus has finished placing it, which is not when the target URL says `hairline`.**
  // An odd last pass navigates the target to `hairline` itself, so that URL is true from the start of the pass
  // while the bus is still mirroring the native pane's two hops into the target. A boundary taken then lets a
  // mirrored commit of `hairline` land after it and be mistaken for the redirect's (a loaded run did exactly
  // that). So: the target is at `hairline`, not loading, and has recorded nothing for a quiet window.
  await expect.poll(targetUrl, { timeout: 10_000 }).toBe(HAIRLINE)
  let quietSince = 0
  await expect
    .poll(
      async () => {
        const last = await lastActivity()
        if (last !== quietSince || (await targetLoading())) {
          quietSince = last
          return 0
        }
        return Date.now() - last
      },
      { timeout: 15_000, intervals: [100], message: 'the target never went quiet after the pool was built: the boundary would not be clean' },
    )
    .toBeGreaterThanOrEqual(QUIET_MS)

  const before = await startsNow()
  const pool = shape(before, HAIRLINE)
  console.log(`[redirect-mirrored-pool] pool for hairline: ${JSON.stringify(pool)}`)

  // **The forcing floors.** The first route's whole result was that six starts
  // are not one condition, so a run that does not build the composition must
  // fail here rather than pass on the assertions below.
  expect(pool.total, `only ${pool.total} starts for hairline: the pool the register's table names was not forced`).toBeGreaterThanOrEqual(FORCE_STARTS)
  expect(
    pool.mirrored,
    `only ${pool.mirrored} of the ${pool.total} starts were the bus's: this is the first route's pool again, not the failing one`,
  ).toBeGreaterThanOrEqual(FORCE_MIRRORED)

  // Ground truth the test owns: nothing recorded before this instant belongs to
  // the redirect that is about to happen.
  const boundary = Date.now()
  await call('navigate', { url: REDIRECT })

  // **WAIT FOR WHAT THE REDIRECT PRODUCES, not for a URL the target may already hold.** The target is
  // at `hairline` when the boundary is taken, so a poll on its URL would pass before the redirect starts.
  // The redirect's own commit, recorded after the boundary, is the thing that did not exist a moment ago.
  await expect
    .poll(async () => redirectRun(await commitsNow(), boundary).landed !== undefined, {
      timeout: 10_000,
      message: 'the redirect never committed hairline after it committed itself: nothing was produced to assert on',
    })
    .toBe(true)

  const after = await startsNow()
  const commits = await commitsNow()
  const { first, redirect, landed } = redirectRun(commits, boundary)
  const startsSinceBoundary = after.filter(s => s.url === HAIRLINE && s.at >= boundary)

  // Printed on pass and fail alike, before any assertion, so a failing run carries it.
  console.log(
    `[redirect-mirrored-pool] after: ${JSON.stringify(shape(after, HAIRLINE))} boundary=${boundary} ` +
      `hairlineStartsSinceBoundary=${JSON.stringify(startsSinceBoundary.map(s => ({ afterBoundaryMs: s.at - boundary, byDocument: s.byDocument, mirrored: s.mirrored })))} ` +
      `commitsSinceBoundary=${JSON.stringify(commits.filter(c => c.at >= boundary).map(c => ({ afterBoundaryMs: c.at - boundary, url: c.url === HAIRLINE ? 'hairline' : c.url === REDIRECT ? 'redirect' : c.url, mirroring: c.mirroring, terms: c.mirrorTerms })))}`,
  )

  // **A failure that names its own cause.** The first commit after the boundary must be the redirect page's own.
  // If something else committed first, the pool was still placing starts when the redirect was triggered: that is
  // this test's setup, not the product, and it is said before the product's answer is read.
  expect(first, 'nothing committed after the boundary: the wait did not wait for what the redirect produces').toBeDefined()
  expect(
    first?.url,
    `the first commit after the boundary was not the redirect page's own (${JSON.stringify(first)}): the pool was not settled, so what follows would not be about the redirect`,
  ).toBe(REDIRECT)
  expect(redirect, 'the redirect page never committed after the boundary').toBeDefined()
  // A straggler that began with the redirect page itself (the bus mirroring `redirect` into the target) passes the
  // check above, and the `hairline` that follows IT would be read as this redirect's landing. It shows as a second
  // start and a second commit of the redirect page after the boundary: this test triggers it once.
  const redirectStarts = after.filter(s => s.url === REDIRECT && s.at >= boundary).length
  const redirectCommits = commits.filter(c => c.kind === 'did-navigate' && c.url === REDIRECT && c.at >= boundary).length
  expect(
    [redirectStarts, redirectCommits],
    `after the boundary the redirect page was started ${redirectStarts} times and committed ${redirectCommits} times, not once each: ` +
      'something else was still loading it, so the pool was not settled and what follows would not be about this redirect',
  ).toEqual([1, 1])

  // **A recorded fact, not a rule copied from the product:** the redirect started a navigation of its own,
  // so a document-initiated, non-mirrored start of the address exists at or after the boundary.
  expect(
    startsSinceBoundary.some(s => s.byDocument && !s.mirrored),
    'no document-initiated, non-mirrored start of hairline was recorded after the redirect was triggered',
  ).toBe(true)

  // **The product's own answer.** The redirect's commit must be the page's, not the bus's, and must have
  // answered the page's own start: a commit answered with an earlier start of the same address would be
  // stamped from THAT start's flags (a bus start, or none that is document-initiated).
  expect(landed, 'the redirect committed, but no commit record was found for it').toBeDefined()
  // `mirrorTerms` is only on a `did-navigate` record that said something (not a restoring or internal commit):
  // an `undefined` there means THAT, not a missing field, so it is said before the terms are read.
  expect(
    landed!.said,
    `the redirect's commit is recorded as having said nothing, so it carries no mirrorTerms: ${JSON.stringify(landed)}`,
  ).toBe(true)
  expect(
    landed!.mirroring,
    `the page's own redirect was stamped the bus's: ${JSON.stringify(landed!.mirrorTerms)}`,
  ).toBe(false)
  expect(
    landed!.mirrorTerms?.answeredOwnStart,
    `the redirect's commit did not answer the page's own start: ${JSON.stringify(landed!.mirrorTerms)}`,
  ).toBe(true)
  expect(await targetUrl()).toBe(HAIRLINE)
})
