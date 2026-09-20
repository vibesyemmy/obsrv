import { test, expect, type ElectronApplication } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'
import { request } from 'node:http'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { CONTROL_FILE_NAME, isDisabledStance, parseControlFile, type ControlInfo } from '../../src/shared/control'
import { launchApp, rendererWindow } from './launch'

/**
 * "The page navigated after it loaded" is about the PAGE moving, not about
 * Obsrv moving its own pane (`bug-arrivals`).
 *
 * The bus mirrors the native pane's commits into the target. `loadMirrored`
 * raises a flag while its promise is in flight, and a commit can be delivered
 * after it resolves — measured at 4 ms late — so the mirror's own landing
 * arrived unmarked and was counted. The reply then said the page had navigated
 * **to the address it was already on**, about a pane nobody had asked to move,
 * in 17 to 20 runs of 20.
 *
 * **Its own file with its own app**, like `sync-mirror-mark.spec`: this drives
 * several commits, and `sync.spec`'s loop breaker counts reversals within a
 * window, so sharing an app perturbs whoever runs next.
 */
let app: ElectronApplication
let info: ControlInfo
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

/** The note under test, from any measurement reply. */
const movedNote = async (): Promise<string | undefined> => {
  const r = await call('inspect', { selector: 'body' })
  return ((r.notes as string[] | undefined) ?? []).find(n => n.includes('navigated after it loaded'))
}

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

test('the target mirroring the native pane is not the page navigating', async () => {
  // Only the NATIVE pane is driven, so every commit the target makes is the
  // bus's doing. The target ends on the address it started on, and must say
  // nothing about having moved.
  await call('navigate', { url: HAIRLINE })
  await expect.poll(() => app.evaluate(() => (globalThis as any).__obsrv.target.webContents.getURL()), { timeout: 10_000 }).toBe(HAIRLINE)

  await app.evaluate(async (_e, url: string) => {
    await (globalThis as any).__obsrv.native.load(url)
  }, REDIRECT)
  // The native pane redirects to the page both panes already show; the bus
  // mirrors both hops in.
  await expect.poll(() => app.evaluate(() => (globalThis as any).__obsrv.native.webContents.getURL()), { timeout: 10_000 }).toBe(HAIRLINE)

  const note = await movedNote()
  expect(note, `the pane was never asked to move, and it ended where it began: ${note}`).toBeUndefined()
})

test('a page that really does redirect after loading still says so', async () => {
  // The other half, and the reason the test above cannot simply ignore
  // same-address commits: here the caller asked for redirect.html and is
  // looking at hairline.html, which is worth a sentence. A fix that silenced
  // the case above and this one with it would be worse than the defect.
  await call('navigate', { url: HAIRLINE })
  await new Promise(r => setTimeout(r, 300))
  await call('navigate', { url: REDIRECT })
  await expect.poll(() => app.evaluate(() => (globalThis as any).__obsrv.target.webContents.getURL()), { timeout: 10_000 }).toBe(HAIRLINE)

  // The URL settling and the note being computed are two different signals,
  // and this used to wait only for the first: one unpolled `movedNote()` right
  // after the poll above returned. Seen undefined twice on CI (`35242092672`,
  // `35524174239`), green on retry both times — the file's own header records
  // the same shape measured at 4 ms late for a sibling consumer. So poll the
  // signal this test actually reads, rather than polling a different one and
  // hoping. `docs/e2e-flakes.md` sized this fix after the first sighting; this
  // is that fix, applied on the second.
  await expect.poll(movedNote, { timeout: 10_000 }).toBeDefined()
  const note = await movedNote()
  expect(note, 'the page asked for redirected itself to another page; that is the note doing its job').toBeDefined()
  expect(note).toContain('hairline.html')
})
