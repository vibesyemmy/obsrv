import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * What `TargetSource` says about a commit that lands on an address the sync bus is also loading
 * (`bug-redirect-note-missing-not-late`), driven through the REAL class.
 *
 * WHY THIS FILE EXISTS. `mirrorTerms.test.ts` calls the decision (`isBusCommit`) with terms it
 * builds by hand. That cannot see the wiring that produces the terms in the real class, and the
 * wiring is where #558's first head failed with 11 of 11 unit tests green:
 *
 *   - a start is stamped `mirrored` from `mirrorRequested` AT START (`did-start-navigation`);
 *   - `startFor(url)` SKIPS mirrored starts, so the BUS's own commit finds the PAGE's start and
 *     inherits its `byDocument: true` — a case the hand-built terms (`byDocument: false`) never
 *     contained;
 *   - the trace keeps 32 starts with no age bound, and a start is not retired by its commit, so an
 *     OLD start of the address is still there when a later, unrelated bus load commits.
 *
 * HOW. `electron` is replaced by a fake `BrowserWindow` whose `webContents` is an `EventEmitter`
 * (own methods real, every other property a no-op proxy). Date is faked so each start carries the
 * time the scenario says. The fake `loadURL` starts a navigation with NO initiator — which is what
 * the bus's `loadMirrored` does — and stays "loading" until the scenario releases it, so
 * `mirrorRequested` stays set exactly as long as the scenario wants. Everything the scenarios
 * assert is produced by real code: `startFor`, `startTimes`, `mirrorTerms`, `isBusCommit`, and the
 * `url-changed` event every consumer (`ipc.ts`, `SyncBus`) listens to.
 *
 * WHAT IT DOES NOT SHOW. The ORDER and COUNT of events is a model of Chromium, taken from the
 * instrument's prints (the page's start first by 25 to 48 ms, then the bus's; 2 of 3 prints had
 * two commits), not a recording from a real one. `arrivals` below is a labelled COPY of the rule in
 * `ipc.ts` (`watchArrivals`), not the live closure: if that rule changes, change it here.
 *
 * R4 and G are the RECORDED case, not a model: R4 replays the fourth instrument print (below) through
 * the real class, and G is its minimal form (an older MIRRORED start of the same address in the trace,
 * which is what made #558's second head compare the wrong start times).
 *
 * Authored by Idris (QA) as a gate probe for #558 and kept as the test of that fix. Written to
 * assert what is CORRECT, so against `main` E, A and A2 fail (E is the original bug; A and A2 are
 * the same bug with a second commit) and against #558's first head A, A2, C and F fail.
 */
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  const deep: any = () =>
    new Proxy(function () {}, {
      get: (_t, p) => (p === 'then' ? undefined : p === Symbol.toPrimitive ? () => 0 : deep()),
      apply: () => undefined,
    })
  class FakeBrowserWindow {
    constructor() {
      const base: any = new EventEmitter()
      base.pending = [] as Array<() => void>
      base.currentUrl = ''
      // The bus's own load: a navigation with no initiator, "loading" until released.
      base.loadURL = (u: string) => {
        if (u === 'about:blank') return Promise.resolve()
        base.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false, url: u })
        return new Promise<void>(res => base.pending.push(res))
      }
      base.getURL = () => base.currentUrl
      base.isDestroyed = () => false
      const wc = new Proxy(base, {
        get: (t, p) => (p in t ? (typeof t[p] === 'function' ? t[p].bind(t) : t[p]) : deep()),
      })
      ;(globalThis as any).__fakeWindows.push(base)
      return new Proxy(this, {
        get: (t: any, p) => (p === 'webContents' ? wc : p === 'isDestroyed' ? () => false : p in t ? t[p] : deep()),
      })
    }
  }
  return { BrowserWindow: FakeBrowserWindow, app: deep() }
})
vi.mock('../../src/main/log', () => ({ log: { warn() {}, info() {}, error() {}, debug() {} } }))

const ADDRESS = 'https://example.test/app'
const ERR_ABORTED = -3
const tick = (): Promise<void> => new Promise<void>(r => setImmediate(r))

interface Heard {
  url: string
  inPage: boolean
  fromBus: boolean
  byDocument: boolean
}

async function rig() {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(0)
  ;(globalThis as any).__fakeWindows = []
  const { TargetSource } = await import('../../src/main/targetSource')
  const ts = new TargetSource(5, { mobileEmulation: false })
  await ts.ready
  const wc = (globalThis as any).__fakeWindows.at(-1)
  const heard: Heard[] = []
  ts.on('url-changed', (url: string, inPage: boolean, fromBus: boolean, byDocument: boolean) =>
    heard.push({ url, inPage, fromBus, byDocument }),
  )
  return {
    heard,
    at: (ms: number) => vi.setSystemTime(ms),
    /** A navigation the pane itself made (an agent's `load`): no initiator, and not the bus's. */
    ownStart: (url: string) => wc.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false, url }),
    /** The page's own navigation: document-initiated, so it has an initiator. */
    pageStart: (url: string) =>
      wc.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false, url, initiator: {} }),
    commit: (url: string) => wc.emit('did-navigate', {}, url, 200, 'OK'),
    /** The spinner stopped: nothing is pending any more, whether or not anything committed. */
    stopLoading: () => wc.emit('did-stop-loading'),
    /** A navigation that ended without committing: Chromium aborted it, and the spinner stopped. */
    abort: (url: string) => {
      wc.emit('did-fail-load', {}, ERR_ABORTED, 'ERR_ABORTED', url, true)
      wc.emit('did-stop-loading')
    },
    /** The sync bus mirroring `url` into this pane, through the door the real bus uses. */
    bus: async (url: string) => {
      const loaded = ts.loadMirrored(url)
      await tick()
      return loaded
    },
    release: () => wc.pending.splice(0).forEach((r: () => void) => r()),
  }
}

/** A COPY of `ipc.ts` `watchArrivals`' counting rule: what an agent would be told about. */
function arrivals(heard: Heard[]): number {
  let n = 0
  let last = ''
  for (const e of heard) {
    if (e.inPage || e.fromBus) continue
    if (e.url === last && !e.byDocument) continue
    n++
    last = e.url
  }
  return n
}
const said = (heard: Heard[]): boolean[] => heard.map(e => e.fromBus)

describe('a commit on an address the bus is also loading, through the real TargetSource', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('E: the page redirected first, the bus asked 25 ms later, one commit lands: it is an arrival', async () => {
    const r = await rig()
    r.at(1000)
    r.pageStart(ADDRESS)
    r.at(1025)
    const loaded = r.bus(ADDRESS)
    await tick()
    r.at(1030)
    r.commit(ADDRESS)
    r.release()
    await loaded
    expect(said(r.heard)).toEqual([false])
    expect(arrivals(r.heard)).toBe(1)
  })

  it('A: the same, and the bus\'s own commit lands too: one arrival, the second commit is the bus\'s', async () => {
    const r = await rig()
    r.at(1000)
    r.pageStart(ADDRESS)
    r.at(1025)
    const loaded = r.bus(ADDRESS)
    await tick()
    r.at(1030)
    r.commit(ADDRESS) // the page's
    r.at(1040)
    r.commit(ADDRESS) // the bus's own, inside loadMirrored's window
    r.release()
    await loaded
    expect(said(r.heard)).toEqual([false, true])
    expect(arrivals(r.heard)).toBe(1)
  })

  it('A2: A, with an older committed start of the same address already in the trace', async () => {
    const r = await rig()
    r.at(100)
    r.pageStart(ADDRESS)
    r.at(110)
    r.commit(ADDRESS)
    r.at(1000)
    r.pageStart(ADDRESS)
    r.at(1025)
    const loaded = r.bus(ADDRESS)
    await tick()
    r.at(1030)
    r.commit(ADDRESS)
    r.at(1040)
    r.commit(ADDRESS)
    r.release()
    await loaded
    expect(said(r.heard)).toEqual([false, false, true])
  })

  it('C: an OLD committed start of the address is in the trace; later the bus ALONE mirrors it in: that commit is the bus\'s', async () => {
    const r = await rig()
    r.at(100)
    r.pageStart(ADDRESS) // a clicked link, or a redirect, to the address, long ago
    r.at(110)
    r.commit(ADDRESS)
    r.at(5000)
    const loaded = r.bus(ADDRESS) // the user's other pane moved there; nothing is navigating this one
    await tick()
    r.at(5020)
    r.commit(ADDRESS)
    r.release()
    await loaded
    expect(said(r.heard)).toEqual([false, true])
    expect(arrivals(r.heard)).toBe(1)
  })

  it('F: an OLD start that never committed (Chromium aborted it) is in the trace; the bus alone mirrors the address in: the bus\'s', async () => {
    const r = await rig()
    r.at(100)
    r.pageStart(ADDRESS)
    r.at(120)
    r.abort(ADDRESS) // superseded or cancelled: no commit will ever answer this start
    r.at(5000)
    const loaded = r.bus(ADDRESS)
    await tick()
    r.at(5020)
    r.commit(ADDRESS)
    r.release()
    await loaded
    expect(said(r.heard)).toEqual([true])
    expect(arrivals(r.heard)).toBe(0)
  })

  it('D: control — nothing in the trace; the bus alone mirrors the address in: the bus\'s', async () => {
    const r = await rig()
    r.at(5000)
    const loaded = r.bus(ADDRESS)
    await tick()
    r.at(5020)
    r.commit(ADDRESS)
    r.release()
    await loaded
    expect(said(r.heard)).toEqual([true])
    expect(arrivals(r.heard)).toBe(0)
  })

  it('B: the bus asked FIRST, the page 25 ms later, to the same address: pins what `main` does for the order the decision does not cover', async () => {
    const r = await rig()
    r.at(1000)
    const loaded = r.bus(ADDRESS)
    await tick()
    r.at(1025)
    r.pageStart(ADDRESS) // stamped `mirrored`, because `mirrorRequested` is this address at this instant
    r.at(1030)
    r.commit(ADDRESS)
    r.release()
    await loaded
    expect(said(r.heard)).toEqual([true])
  })

  it('B2: B, with an older committed start of the address in the trace: no worse than `main`', async () => {
    const r = await rig()
    r.at(100)
    r.pageStart(ADDRESS)
    r.at(110)
    r.commit(ADDRESS)
    r.at(1000)
    const loaded = r.bus(ADDRESS)
    await tick()
    r.at(1025)
    r.pageStart(ADDRESS)
    r.at(1030)
    r.commit(ADDRESS)
    r.release()
    await loaded
    expect(said(r.heard)).toEqual([false, true])
  })
})

const BASE = 'file:///Users/runner/work/obsrv/obsrv/tests/fixtures/'
const HAIRLINE = BASE + 'hairline.html'
const REDIRECT = BASE + 'redirect.html'

describe('a recorded print, replayed through the real TargetSource', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  /**
   * The fourth instrument print of `bug-redirect-note-missing-not-late`: `main`'s push suite for
   * 721f5d9 (run 37278055730), the retried `arrivals.spec.ts:218`, whose guard said "note MISSING
   * where one was expected". Every start and commit below is one of the print's, in its order, with
   * its `mirrored` and `initiator` flags; the times are the print's own, in ms. The commit it
   * recorded as `mirroring: true` is the last one. On `main` this replay reproduces that: the same
   * terms (`byDocument`, `viaMirrorUrl`, nothing else), which is what makes it a replay.
   *
   * The page's redirect (`…754`) comes AFTER a mirrored start of the same address (`…077`): an
   * older mirror of the address is in the trace, and must not decide this commit.
   */
  it('R4: the page\'s own redirect to hairline, with an older mirrored start of hairline in the trace, is not the bus\'s', async () => {
    const r = await rig()
    r.at(520642)
    r.ownStart(HAIRLINE)
    r.at(520877)
    r.commit(HAIRLINE)
    r.at(520996)
    const first = r.bus(REDIRECT) // the bus mirrors redirect.html in
    await tick()
    r.at(521071)
    r.commit(REDIRECT) // claimed by the bus
    r.release()
    await first
    r.at(521077)
    const second = r.bus(HAIRLINE) // a mirrored hairline start, from a bus-placed document
    await tick()
    r.release()
    await second // over before its commit lands, as in the print
    r.at(521168)
    r.commit(HAIRLINE)
    r.at(521293)
    r.ownStart(HAIRLINE)
    r.at(521357)
    r.commit(HAIRLINE)
    r.at(521679)
    r.ownStart(REDIRECT)
    r.at(521741)
    r.commit(REDIRECT)
    r.at(521754)
    r.pageStart(HAIRLINE) // the page's own redirect: document-initiated
    r.at(521792)
    const third = r.bus(HAIRLINE) // the bus's mirrored load of the same address, 38 ms later
    await tick()
    r.at(521838)
    r.commit(HAIRLINE) // the commit the print recorded as mirroring: true
    r.release()
    await third
    expect(r.heard.at(-1)?.fromBus).toBe(false)
  })

  it('G: R4 in its smallest form — an older mirrored (answered) start of the address, then the page\'s redirect first and the bus 25 ms later', async () => {
    const r = await rig()
    r.at(100)
    const earlier = r.bus(ADDRESS)
    await tick()
    r.at(110)
    r.commit(ADDRESS) // the bus's own earlier load of the address, answered
    r.release()
    await earlier
    // an own navigation elsewhere, so the document is no longer the bus's (`viaBusDocument` rightly
    // stamps a bus-placed document's own redirect as the bus's, which is not what G is about)
    r.at(500)
    r.ownStart(REDIRECT)
    r.at(510)
    r.commit(REDIRECT)
    r.at(1000)
    r.pageStart(ADDRESS)
    r.at(1025)
    const loaded = r.bus(ADDRESS)
    await tick()
    r.at(1030)
    r.commit(ADDRESS)
    r.release()
    await loaded
    expect(said(r.heard)).toEqual([true, false, false])
  })
})

describe('a start that ended with no commit and no failure at its address', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  /**
   * H1b: an old document-initiated start of the address whose navigation ENDED elsewhere (it redirected,
   * or was replaced): no `did-navigate` and no `did-fail-load` ever answers it, though the spinner stopped.
   * Later the bus alone mirrors that address in, and its commit there must still be the bus's.
   *
   * A plausible trigger is a page that navigates to a gated address which redirects to /login, after which
   * the user logs in and the other pane goes to that address. `main` classifies this correctly (it skips
   * mirrored starts and the bus's `viaMirrorUrl` claims the commit); #558's heads call the bus's commit the
   * page's, because the oldest UNANSWERED start of the address is that old one.
   *
   * One candidate fix, verified only against this fake: `did-stop-loading` marks every unanswered start
   * answered. Whether that is safe in a real Chromium is not shown here (a stale stop arriving after a NEW
   * start was recorded would retire it too early), so this test is the finding, not the endorsement.
   */
  it('H1b: the bus alone mirrors in an address that an old start of the page\'s never answered: the bus\'s', async () => {
    const r = await rig()
    r.at(100)
    r.pageStart(ADDRESS) // ends by redirecting elsewhere: no commit here, no failure
    r.at(150)
    r.stopLoading()
    r.at(5000)
    const loaded = r.bus(ADDRESS)
    await tick()
    r.at(5020)
    r.commit(ADDRESS)
    r.release()
    await loaded
    expect(said(r.heard)).toEqual([true])
    expect(arrivals(r.heard)).toBe(0)
  })
})
