import { afterEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' }, ipcMain: { on: () => {} } }))
vi.mock('../../src/main/log', () => ({ log: { warn: () => {}, info: () => {}, error: () => {} } }))

const { attachSyncBus } = await import('../../src/main/syncBus')
import type { NativePane } from '../../src/main/nativePane'
import type { TargetSource } from '../../src/main/targetSource'

/**
 * The bus driven directly, with the panes faked.
 *
 * Everything the mirror decision touches is four methods and two events, and
 * the states that matter are ones the live app reaches by luck — a commit that
 * does not arrive, a record left behind. `flake-sync-165` took 113 e2e runs to
 * show four failures; here the same state is set rather than waited for.
 */
class FakeWebContents extends EventEmitter {
  url = 'about:blank'
  destroyed = false
  isDestroyed(): boolean {
    return this.destroyed
  }
  getURL(): string {
    return this.url
  }
  send(): void {}
}

class FakeNative extends EventEmitter {
  webContents = new FakeWebContents()
  loaded: string[] = []
  async load(url: string): Promise<string> {
    this.loaded.push(url)
    return url
  }
  /** A main-frame, cross-document navigation starting in the native pane. */
  start(url: string): void {
    this.webContents.emit('did-start-navigation', { url, isMainFrame: true, isSameDocument: false })
  }
  /** The server redirecting that navigation. */
  redirect(url: string): void {
    this.webContents.emit('did-redirect-navigation', { url, isMainFrame: true, isSameDocument: false })
  }
  /** A commit in the native pane, as Electron reports one. */
  commit(url: string, inPage = false): void {
    this.webContents.url = url
    this.webContents.emit(inPage ? 'did-navigate-in-page' : 'did-navigate', {}, url, true)
  }
}

class FakeTarget extends EventEmitter {
  webContents = new FakeWebContents()
  mirrored: string[] = []
  loaded: string[] = []
  async loadMirrored(url: string): Promise<string> {
    this.mirrored.push(url)
    return url
  }
  async load(url: string): Promise<string> {
    this.loaded.push(url)
    return url
  }
  /** A main-frame, cross-document navigation starting, as `TargetSource` reports one. */
  start(url: string): void {
    this.emit('navigating', url)
  }
  /** The server redirecting that navigation. */
  redirect(url: string): void {
    this.emit('redirected', url)
  }
  /**
   * A commit in the target pane. `mirrored` is the flag `TargetSource` sets
   * for a load the bus itself issued — and `syncBus`'s listener drops those
   * before the mirror decision runs, which is the fact this file exists to
   * pin down.
   */
  commit(url: string, { inPage = false, mirrored = false } = {}): void {
    this.webContents.url = url
    this.emit('url-changed', url, inPage, mirrored)
  }
}

afterEach(() => vi.restoreAllMocks())

const A = 'https://a.test/'
const B = 'https://b.test/'

const bus = () => {
  const native = new FakeNative()
  const target = new FakeTarget()
  const reported: string[] = []
  // A clock that moves. Real loads are milliseconds apart and the bus retires
  // "everything sent at or before" a commit, so a fake that fires two loads
  // inside one millisecond makes the second sweep the first and tests an
  // arrangement the app never produces.
  let t = 1_700_000_000_000
  vi.spyOn(Date, 'now').mockImplementation(() => (t += 10))
  const sync = attachSyncBus(native as unknown as NativePane, target as unknown as TargetSource, u => reported.push(u))
  return { native, target, sync, reported }
}

describe('SyncBus: a mirrored load that never commits back', () => {
  it("does not leave a record that swallows the target's next genuine navigation", () => {
    const { native, target, sync } = bus()

    // Native goes to A; the bus mirrors it into the target.
    native.commit(A)
    expect(target.mirrored).toEqual([A])

    // The target's commit of that mirrored load never reaches the decision:
    // `onTargetNav` returns early when `mirrored` is set, so nothing retires
    // the record the bus just wrote. This is not a fault in itself — it is why
    // the target's records are retired by age or by a genuine commit, and
    // never by an echo.
    target.commit(A, { mirrored: true })

    // Native moves on. The target is mirrored again; the record for A is still
    // there, because only a target-side decision retires target records and
    // none has run.
    native.commit(B)
    expect(target.mirrored).toEqual([A, B])
    target.commit(B, { mirrored: true })

    // Now the user drives the TARGET back to A. This is a genuine navigation,
    // not the echo of the mirrored load from two steps ago — and the native
    // pane, sitting on B, must follow it.
    target.commit(A)

    expect(native.loaded).toEqual([A])
    const last = sync.mirrorTrace().at(-1)
    expect(last).toMatchObject({ from: 'target', url: A, branch: 'issued' })
  })

  it('still treats a mirrored load that DOES come back as an echo, and mirrors nothing', () => {
    // The other half, and the one the 252-load loop of 2026-09-03 bought: a
    // commit the bus caused must not be mirrored back. Native's mirrored loads
    // do reach the decision, so this is the path that must keep working.
    const { native, target, sync } = bus()

    target.commit(A)
    expect(native.loaded).toEqual([A])
    native.commit(A) // the mirrored load's own commit, in the native pane

    expect(target.mirrored).toEqual([])
    expect(sync.mirrorTrace().at(-1)).toMatchObject({ from: 'native', url: A, branch: 'echo' })
  })

  it('a superseded load still commits, and its commit is not news', () => {
    // Two mirrored loads in flight into the native pane: the superseded one
    // commits anyway. Reading that as a new document is what produced 252
    // mirrored loads on 2026-09-03, so both commits must read as echoes.
    const { native, target, sync } = bus()

    target.commit(A)
    target.commit(B)
    expect(native.loaded).toEqual([A, B])

    native.commit(A)
    native.commit(B)
    expect(target.mirrored).toEqual([])
    expect(sync.mirrorTrace().filter(d => d.branch === 'echo')).toHaveLength(2)
  })
})

describe('SyncBus: a server redirect of a navigation the bus issued', () => {
  // surface-parity's `redirect` page: a 302 from /redirect to /landed. Both
  // panes are told to load /redirect, both follow the redirect, and each
  // commits /landed. Read as news, the first commit was mirrored into the
  // other pane while that pane was loading the same page: the target loaded it
  // twice, and a live scroll sent between the two commits was never answered
  // (probe run 35158932493, 4 of 12 apps).
  const ASKED = 'https://a.test/redirect'
  const LANDED = 'https://a.test/landed'

  it('is that navigation arriving in each pane when the native pane commits first', () => {
    const { native, target, sync, reported } = bus()
    sync.expect(ASKED)
    native.start(ASKED)
    target.start(ASKED)
    native.redirect(LANDED)
    target.redirect(LANDED)
    native.commit(LANDED)
    expect(target.mirrored).toEqual([])
    target.commit(LANDED)
    expect(native.loaded).toEqual([])
    expect(reported).toEqual([LANDED])
  })

  it('and when the target commits first', () => {
    const { native, target, sync, reported } = bus()
    sync.expect(ASKED)
    target.start(ASKED)
    native.start(ASKED)
    target.redirect(LANDED)
    native.redirect(LANDED)
    target.commit(LANDED)
    expect(native.loaded).toEqual([])
    native.commit(LANDED)
    expect(target.mirrored).toEqual([])
    expect(reported).toEqual([LANDED])
  })

  it("is still mirrored when the navigation was the page's own", () => {
    const { native, target } = bus()
    native.start('https://a.test/link')
    native.redirect(LANDED)
    native.commit(LANDED)
    expect(target.mirrored).toEqual([LANDED])
  })

  it("leaves no record behind that swallows the pane's next genuine navigation to the same URL", () => {
    const { native, target } = bus()
    // A mirrored load into the target that the server redirects.
    native.commit(ASKED)
    expect(target.mirrored).toEqual([ASKED])
    target.start(ASKED)
    target.redirect(LANDED)
    target.commit(LANDED, { mirrored: true })
    // Later the target goes to LANDED on its own: news, mirrored into the native pane.
    native.commit('https://a.test/elsewhere')
    target.commit('https://a.test/elsewhere', { mirrored: true })
    target.start(LANDED)
    target.commit(LANDED)
    expect(native.loaded).toContain(LANDED)
  })
})
