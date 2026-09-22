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

/** One start as `TargetSource` records it. */
type Start = { at: number; url: string; byDocument: boolean; mirrored: boolean }
/** A commit as `commitTrace()` records it — `mirroring` is the bus's provenance. */
type Commit = { at: number; url: string; kind: string; said: boolean; mirroring?: boolean }
/** What the probe reports. `reachable: false` means `__obsrv.target` was gone. */
type GuardSeen =
  | { reachable: false }
  | { reachable: true; url: string; matched: Start | null; startsForThisUrl: number; starts: Start[]; commits: Commit[] }

/**
 * What the arrivals guard was looking at when it decided, printed on failure.
 *
 * `bug-redirect-note-missing-not-late`. Both tests below turn on one field:
 * `ipc.ts`'s guard drops a commit when `url === arrivals.url && !byDocument`,
 * and `byDocument` is `startedByDocument(url)` — a reverse-find over `starts`
 * for an entry whose url matches, each entry's flag being
 * `details.initiator !== undefined` from `did-start-navigation`.
 *
 * `:89` has failed with the note MISSING and `:71` with it PRESENT, which are
 * the same field wrong in opposite directions. Three people read this path and
 * a run still surprised all of them, so this prints the inputs rather than
 * inviting a fourth reading. **No product change**: `commitTrace()` is public
 * and documented for exactly this question, and `starts` is private only to
 * TypeScript — at runtime it is a field on the same object the specs already
 * reach through `__obsrv.target`.
 */
async function sayWhatTheGuardSaw(app: ElectronApplication, label: string, detail: boolean): Promise<GuardSeen> {
  const seen = await app.evaluate(() => {
    const t = (globalThis as unknown as { __obsrv?: { target?: unknown } }).__obsrv?.target as
      | { commitTrace?: () => unknown[]; starts?: Start[]; webContents?: { getURL(): string } }
      | undefined
    if (t === undefined) return { reachable: false as const }
    const starts = Array.isArray(t.starts) ? t.starts : []
    const url = t.webContents?.getURL?.() ?? '(no webContents)'
    // What `startedByDocument(url)` would answer right now, computed the same
    // way it computes it — the last start recorded FOR THIS URL.
    // The same find `startedByDocument` does, mirrored starts skipped.
    const matched = [...starts].reverse().find(x => x.url === url && !x.mirrored)
    return {
      reachable: true as const,
      url,
      matched: matched ?? null,
      startsForThisUrl: starts.filter(x => x.url === url).length,
      starts: starts.slice(-8),
      commits: ((t.commitTrace?.() ?? []) as Commit[]).slice(-8),
    }
  })
  // **This runs on every pass, not only on failure**, and that is the point.
  // An instrument that only executes on the failure path is a control nobody
  // has watched succeed — this repository has spent two days on exactly that
  // mistake in other forms. Running it green every time proves the probe still
  // reaches `__obsrv.target` and that the field names survived the build, and
  // it leaves a **baseline** beside the eventual failure: the same fields, on
  // the run where the guard got it right.
  //
  // Compact on the expected path so 600 green runs stay readable; the whole
  // block on the surprising one, because the useful comparison is between
  // fields — a `matched` with `byDocument:false` and `startsForThisUrl` above
  // 1 is the reverse-find picking the wrong navigation, and that reads only
  // with both numbers in front of you.
  const line = `ARRIVALS GUARD (bug-redirect-note-missing-not-late) ${label}`
  if (!detail || !seen.reachable) {
    console.log(`${line}: ${JSON.stringify(seen.reachable ? { url: seen.url, matched: seen.matched, startsForThisUrl: seen.startsForThisUrl, commits: seen.commits } : seen)}`)
    return seen
  }
  console.log(`${line}: ${JSON.stringify(seen, null, 2)}`)
  return seen
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
  const seen = await sayWhatTheGuardSaw(app, note === undefined ? 'baseline, note absent as expected (:71)' : 'note PRESENT where none was expected (:71)', note !== undefined)
  expect(note, `the pane was never asked to move, and it ended where it began: ${note}`).toBeUndefined()

  // **The control for the mirrored direction, asserting what the design claims
  // rather than what one trace showed.** An earlier version asserted "the last
  // commit for this address is the bus's", written from a single run; a 20x
  // sweep (`35725663287`) found that false 3 times in 20, because the commit
  // ordering varies.
  //
  // What holds however they interleave: **no commit after the setup is
  // attributed to the page.** The bus put `redirect.html` here and its own
  // `location.replace` followed, so `documentFromBus` carries that provenance
  // past `loadMirrored`'s window and every commit in the chain is the bus's.
  // If one is ever unmarked, `ipc.ts:230` lets it through and the note fires
  // for a pane nobody asked to move — `bug-arrivals`, returning. That is
  // exactly what the withdrawn `#431` did, 4 times in 20.
  if (seen.reachable) {
    const here = seen.commits.filter(c => c.url === seen.url)
    expect(here.length, `no commit for ${seen.url}; the fixture no longer produces this case`).toBeGreaterThan(0)
    const notTheBus = here.slice(1).filter(c => c.mirroring !== true)
    expect(notTheBus, `a commit after the setup was not attributed to the bus: ${JSON.stringify(notTheBus)}`).toEqual([])
  }
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

  // **Deliberately NOT polled.** A poll was tried here and removed: on run
  // `35525940597` it sat on `movedNote()` for the full 10 s and still got
  // `undefined`, then passed on retry in 684 ms. The note is not arriving
  // late, it is not arriving at all on the failing attempt — see
  // `docs/e2e-flakes.md`'s entry for this test. A longer wait cannot fix a
  // value that is never produced, and a poll here only turns a fast, honest
  // failure into a slow one that reads like a timeout.
  const note = await movedNote()
  const seen = await sayWhatTheGuardSaw(app, note === undefined ? 'note MISSING where one was expected (:89)' : 'baseline, note present as expected (:89)', note === undefined)
  expect(note, 'the page asked for redirected itself to another page; that is the note doing its job').toBeDefined()
  expect(note).toContain('hairline.html')

  // **The control for the redirect direction.** `#429` measured this test
  // passing on broken code: `startedByDocument` returned the MIRROR's start,
  // and the note survived only because `ipc.ts:245`'s other half happened not
  // to hold. "The note appeared" is therefore satisfied by code that cannot
  // attribute a navigation at all, so this asserts the guard reached the
  // DOCUMENT's own start.
  if (seen.reachable) {
    expect(seen.matched?.byDocument, `the guard did not reach the document's own start: ${JSON.stringify(seen.matched)}`).toBe(true)
    expect(seen.matched?.mirrored, `the matched start was the bus's: ${JSON.stringify(seen.matched)}`).toBe(false)
  }
})
