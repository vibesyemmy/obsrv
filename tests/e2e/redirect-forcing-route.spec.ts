import { test, expect, type ElectronApplication } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'
import { request } from 'node:http'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { CONTROL_FILE_NAME, isDisabledStance, parseControlFile, type ControlInfo } from '../../src/shared/control'
import { launchApp, rendererWindow } from './launch'

/**
 * **The forcing route for `bug-redirect-note-missing-not-late`.**
 *
 * The register's `arrivals.spec.ts:89` entry has a candidate mechanism and six
 * sightings behind it: `startFor(url)` is
 * `[...starts].reverse().find(s => s.url === url && !s.mirrored)`, starts are
 * **never retired**, and every observed failure had `startsForThisUrl = 6` while
 * every pass had 2 or 3. So the reading is that with enough same-url starts the
 * find answers a commit with a start belonging to an **earlier** navigation,
 * whose `byDocument` is false, and `ipc.ts:245` then drops the commit and the
 * note is never produced.
 *
 * **This test does not assert the bug.** It forces the condition on purpose —
 * six starts for one address before the redirect — and asserts the property that
 * must hold either way: **the start the find answers with belongs to the
 * navigation being answered**, not to one before it.
 *
 * **Why the assertion is by time and not by url.** Idris caught the first version
 * of this: asserting the chosen start's url matches the commit's restates
 * `startFor`'s own predicate, so it cannot fail on any build, fixed or broken.
 * The test instead owns the ground truth — it records the instant before the
 * redirect is triggered, and the only honest start for that navigation is one
 * recorded after it. That can fail today.
 *
 * **It may pass here and fail in CI.** `bug-redirect-note-missing-not-late`
 * records a 20x local sweep on both arms: 0 crosses in 40 each, against a CI rate
 * of 3 in 20. A green run on this machine is not evidence either way, which is
 * why this lands as a route rather than as a verdict.
 */
const HAIRLINE = pathToFileURL(resolve(__dirname, '../fixtures/hairline.html')).href
const TALL = pathToFileURL(resolve(__dirname, '../fixtures/tall.html')).href
const REDIRECT = pathToFileURL(resolve(__dirname, '../fixtures/redirect.html')).href

/** How many same-url starts the register's table says separates a failure from a
 *  pass: six in every failure, two or three in every pass. */
const FORCE_STARTS = 6

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

test('the start a redirect commit is answered with belongs to that redirect, not to an earlier visit to the same address', async () => {
  // Force the condition: alternate so each hairline visit records its own start
  // for the same address. `tall.html` is only somewhere else to be in between.
  for (let i = 0; i < FORCE_STARTS; i++) {
    await call('navigate', { url: HAIRLINE })
    await expect.poll(targetUrl, { timeout: 10_000 }).toBe(HAIRLINE)
    await call('navigate', { url: TALL })
    await expect.poll(targetUrl, { timeout: 10_000 }).toBe(TALL)
  }

  const before = await startsNow()
  const forHairline = before.filter(s => s.url === HAIRLINE).length
  // **The forcing floor.** If the loop did not actually accumulate the
  // condition, everything below tests nothing — and would pass. The register's
  // table is explicit that 2 or 3 is the passing shape, so a run that only
  // reached 3 must say so rather than report a green.
  expect(forHairline, `only ${forHairline} starts for hairline: the condition the register names was not forced`).toBeGreaterThanOrEqual(FORCE_STARTS)

  // Ground truth the test owns: nothing recorded before this instant belongs to
  // the redirect that is about to happen.
  const boundary = Date.now()
  await call('navigate', { url: REDIRECT })
  await expect.poll(targetUrl, { timeout: 10_000 }).toBe(HAIRLINE)

  const after = await startsNow()
  // The same find `startFor` does, on the same data.
  const matched = [...after].reverse().find(s => s.url === HAIRLINE && !s.mirrored)
  const forHairlineAfter = after.filter(s => s.url === HAIRLINE).length

  console.log(
    `[redirect-forcing-route] startsForHairline before=${forHairline} after=${forHairlineAfter} ` +
      `boundary=${boundary} matched=${matched ? `at=${matched.at} byDocument=${matched.byDocument} age=${boundary - matched.at}ms` : 'none'}`,
  )

  expect(matched, 'no start was found for the address the redirect landed on').toBeDefined()
  // **The assertion the test owns.** A start recorded before the redirect was
  // triggered cannot be that redirect's, however well its url matches — which is
  // exactly what `startFor` cannot tell, because it matches on url alone and
  // never retires a consumed start.
  expect(
    matched!.at,
    `the commit was answered with a start from ${boundary - matched!.at} ms before the redirect was triggered — an earlier visit to the same address`,
  ).toBeGreaterThanOrEqual(boundary)
})
