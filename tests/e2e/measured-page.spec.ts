import { test, expect, type ElectronApplication } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'
import { createServer, request, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { CONTROL_FILE_NAME, isDisabledStance, parseControlFile, type ControlInfo } from '../../src/shared/control'
import { launchApp, rendererWindow } from './launch'
import { holdNativeOutOf } from './holdNativeOut'
import { historyMoveNote } from '../../src/shared/measureBudget'

/**
 * "Did I get the page I asked for?" (bug-measured-page-is-not-the-asked-page).
 *
 * The arrivals count answers a different question, "who made this commit",
 * and when the sync bus loads the other pane's page into the target the honest
 * answer is "the bus did", so nothing is counted and "the page navigated after
 * it loaded" rightly stays quiet (`arrivals.spec.ts`, "the target mirroring the
 * native pane is not the page navigating"). Until this file, nothing else spoke
 * either: a measurement of a page the caller never asked for came back looking
 * exactly like a measurement of the one they did.
 *
 * The race the card was filed on (the bus's mirrored landing beating a page's
 * own redirect, 21 runs in 30 with the target on `cpu-4x`) is a timing, and a
 * timing makes a poor control. So these tests drive the same mechanism head on
 * and every run: the caller navigates to one page, the native pane loads
 * another, and the bus carries the target there. The commit is mirrored, the
 * count stays put, and the page measured is not the page asked for.
 *
 * **Its own file with its own app**, like `arrivals.spec`: this drives the
 * native pane on its own, and `sync.spec`'s loop breaker counts reversals
 * within a window.
 */
let app: ElectronApplication
let info: ControlInfo
const TALL = pathToFileURL(resolve(__dirname, '../fixtures/tall.html')).href
const HAIRLINE = pathToFileURL(resolve(__dirname, '../fixtures/hairline.html')).href
const REDIRECT = pathToFileURL(resolve(__dirname, '../fixtures/redirect.html')).href

const call = (command: string, payload?: Record<string, unknown>): Promise<Record<string, unknown>> =>
  new Promise((done, fail) => {
    const body: Record<string, unknown> = { command, token: info.token }
    if (payload) body.payload = payload
    const req = request(
      { host: '127.0.0.1', port: info.port, method: 'POST', path: '/', headers: { 'content-type': 'application/json' } },
      res => {
        let text = ''
        res.on('data', d => (text += String(d)))
        res.on('end', () => {
          try {
            done(JSON.parse(text) as Record<string, unknown>)
          } catch {
            done({ raw: text })
          }
        })
      },
    )
    req.on('error', fail)
    req.end(JSON.stringify(body))
  })

const targetUrl = (): Promise<string> => app.evaluate(() => (globalThis as any).__obsrv.target.webContents.getURL())
const nativeUrl = (): Promise<string> => app.evaluate(() => (globalThis as any).__obsrv.native.webContents.getURL())
const loadNativeOnly = (url: string): Promise<void> =>
  app.evaluate(async (_e, u: string) => {
    await (globalThis as any).__obsrv.native.load(u)
  }, url)

/** Every note an inspect reply carried. All of them, so a failure says what WAS said. */
const notesNow = async (): Promise<string[]> => {
  const r = await call('inspect', { selector: 'body' })
  return (r.notes as string[] | undefined) ?? []
}
/** The sentence under test, by the words only it uses. */
const elsewhereIn = (notes: string[]): string | undefined => notes.find(n => n.includes('without the page moving itself'))
const movedIn = (notes: string[]): string | undefined => notes.find(n => n.includes('navigated after it loaded'))

test.beforeAll(async () => {
  app = await launchApp([], { OBSRV_AGENT_CONTROL: '1' })
  await rendererWindow(app)
  const userData = await app.evaluate(({ app: a }) => a.getPath('userData'))
  const controlFile = join(userData, CONTROL_FILE_NAME)
  await expect.poll(() => existsSync(controlFile)).toBe(true)
  const parsed = parseControlFile(readFileSync(controlFile, 'utf8'))
  if (!parsed || isDisabledStance(parsed)) throw new Error('agent control is off in this app')
  info = parsed
})
test.afterAll(async () => {
  await app.close()
})

/** Set by a test that holds the native pane out of an address; released after it, whatever the outcome. */
let releaseNative: (() => Promise<void>) | undefined
test.afterEach(async () => {
  await releaseNative?.()
  releaseNative = undefined
})

test('a measurement of a page the bus carried the target to says which page it measured', async () => {
  await call('navigate', { url: TALL })
  await expect.poll(targetUrl, { timeout: 10_000 }).toBe(TALL)
  // The baseline, in the same app: the page asked for is the page measured, and nothing is said.
  const before = await notesNow()
  expect(elsewhereIn(before), `nothing moved yet, and the reply said: ${JSON.stringify(before)}`).toBeUndefined()

  await loadNativeOnly(HAIRLINE)
  await expect.poll(targetUrl, { timeout: 10_000 }).toBe(HAIRLINE)

  const notes = await notesNow()
  const note = elsewhereIn(notes)
  expect(
    note,
    notes.length === 0
      ? 'asked for tall.html, measured hairline.html, and the reply carried NO notes at all: the silence this card is filed on'
      : `the sentence is missing, but the reply carried ${notes.length} other note(s): ${JSON.stringify(notes)}`,
  ).toBeDefined()
  // Both addresses, measured first, so a caller can act on it without a second call.
  expect(note).toContain(`the figures are of ${HAIRLINE}, not of ${TALL}`)
  // About which page was measured, never about the page moving: the bus moved the pane, and the count is right to say nothing.
  expect(movedIn(notes), `the bus's commit was reported as the page navigating: ${JSON.stringify(notes)}`).toBeUndefined()
})

test('a live lint carries the same sentence, since all three measurements say which page in one place', async () => {
  await call('navigate', { url: TALL })
  await expect.poll(targetUrl, { timeout: 10_000 }).toBe(TALL)
  await loadNativeOnly(HAIRLINE)
  await expect.poll(targetUrl, { timeout: 10_000 }).toBe(HAIRLINE)

  const r = await call('lint', {})
  expect(r.ok, JSON.stringify(r).slice(0, 300)).toBe(true)
  const said = [...((r.warnings as string[] | undefined) ?? []), ...((r.notes as string[] | undefined) ?? [])]
  expect(elsewhereIn(said), `said: ${JSON.stringify(said)}`).toContain(`the figures are of ${HAIRLINE}, not of ${TALL}`)
})

test('a pane the bus moved and brought back to the page asked for says nothing', async () => {
  // The counter-case, in this sentence's terms: `arrivals.spec`'s "the target mirroring the native pane is not
  // the page navigating" checks that the NAVIGATED note stays quiet here, and this checks the new one does. The
  // native pane redirects to the page both panes already show; the target ends where it was asked to be.
  await call('navigate', { url: HAIRLINE })
  await expect.poll(targetUrl, { timeout: 10_000 }).toBe(HAIRLINE)
  await loadNativeOnly(REDIRECT)
  await expect.poll(nativeUrl, { timeout: 10_000 }).toBe(HAIRLINE)
  await expect.poll(targetUrl, { timeout: 10_000 }).toBe(HAIRLINE)

  const notes = await notesNow()
  expect(elsewhereIn(notes), `the page measured is the page asked for, and the reply said: ${JSON.stringify(notes)}`).toBeUndefined()
})

test('a page that redirects itself is named by exactly one sentence, whichever pane won', async () => {
  // When the page moves itself, the navigated note names where it went, and this sentence must not repeat
  // it. When the bus's mirrored landing wins instead (the race this card was filed on), the count rightly
  // says nothing and this sentence is the only one left to say it. Either way the caller asked for
  // redirect.html and the figures are of hairline.html, so EXACTLY ONE of the two names it: both is the
  // journey said twice, neither is the silence. The native pane is held out of the redirect page, as in
  // `arrivals.spec`'s "a page that really does redirect after loading still says so", so the page's own
  // redirect usually wins, but nothing here depends on which one did.
  await call('navigate', { url: HAIRLINE })
  await expect.poll(targetUrl, { timeout: 10_000 }).toBe(HAIRLINE)
  releaseNative = await holdNativeOutOf(app, [REDIRECT])
  await call('navigate', { url: REDIRECT })
  await expect.poll(targetUrl, { timeout: 10_000 }).toBe(HAIRLINE)

  const notes = await notesNow()
  const naming = [movedIn(notes), elsewhereIn(notes)].filter((n): n is string => n !== undefined)
  expect(naming.length, `asked for redirect.html, measured hairline.html; the sentences that said so: ${JSON.stringify(notes)}`).toBe(1)
  expect(naming[0]).toContain('hairline.html')
})

// The two sentences that already name the page measured, each of which the new one must leave alone. The
// behaviour above passes with either guard removed, so these are what holds them (Idris, room #4734).

test('a load a server redirected to a login page is named by the landed sentence alone', async () => {
  // The commonest redirect there is: the route 302s to /login, so the page measured is not the page asked for,
  // and `landedElsewhereNote` already says so. The new sentence repeating it would say the pane "moved there
  // without the page moving itself", which is false: the server moved it.
  const server: Server = createServer((req, res) => {
    if ((req.url ?? '').startsWith('/private')) {
      res.writeHead(302, { Location: '/login' })
      res.end()
      return
    }
    res.setHeader('Content-Type', 'text/html')
    res.end('<!doctype html><html lang="en"><body style="font:16px system-ui"><h1>Sign in</h1></body></html>')
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  try {
    await call('navigate', { url: `${origin}/private` })
    await expect.poll(targetUrl, { timeout: 10_000 }).toBe(`${origin}/login`)
    const notes = await notesNow()
    const landed = notes.find(n => n.includes('ended at'))
    expect(landed, `the landed sentence is missing: ${JSON.stringify(notes)}`).toContain(`${origin}/login`)
    expect(elsewhereIn(notes), `the landing was already named, and said again: ${JSON.stringify(notes)}`).toBeUndefined()
  } finally {
    await new Promise<void>(r => server.close(() => r()))
  }
})

test('a Back the agent issued is named by the history sentence alone', async () => {
  // After a Back the page measured is not the one the last navigate asked for, and the history sentence says
  // which page it is and why. The new sentence adding to it would blame the sync for a move the agent made.
  await call('navigate', { url: TALL })
  await expect.poll(targetUrl, { timeout: 10_000 }).toBe(TALL)
  await call('navigate', { url: HAIRLINE })
  await expect.poll(targetUrl, { timeout: 10_000 }).toBe(HAIRLINE)
  await call('back')
  await expect.poll(targetUrl, { timeout: 10_000 }).toBe(TALL)

  const notes = await notesNow()
  expect(notes, `the history sentence is missing: ${JSON.stringify(notes)}`).toContain(historyMoveNote({ kind: 'back', by: 'agent' }, TALL, HAIRLINE))
  expect(elsewhereIn(notes), `the Back was already named, and said again: ${JSON.stringify(notes)}`).toBeUndefined()
})

