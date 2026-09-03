import type { IpcMainEvent } from 'electron'
import { IPC } from '../shared/ipc'
import { parseScrollPos } from '../shared/ipcPayloads'
import { log } from './log'
import type { NativePane } from './nativePane'
import type { TargetSource } from './targetSource'

export interface SyncBus {
  /**
   * Announce a URL that is deliberately being loaded into both panes, so the
   * resulting pair of `did-navigate` events is not read as a one-sided
   * navigation and mirrored a second time.
   */
  expect(url: string): void
  /**
   * Applies one `syncScroll` message to this pair. `ipcMain.on` is
   * process-global, so a bus per tab that registered its own listener would
   * receive every tab's scrolls — a scroll in one tab moving another. The
   * `TabManager` owns the single listener, resolves `e.sender` to its session,
   * and calls this. See the spec's global-channel section.
   */
  onScroll(e: IpcMainEvent, raw: unknown): void
  detach(): void
}

type Pane = 'native' | 'target'

/**
 * Mirrors that keep reversing direction closer together than this are a loop —
 * typically a SPA that rewrites its own URL on load, so each pane's commit
 * differs from the other's and they chase each other forever. One reversal is
 * legitimate (a redirect mirrored one way, then a navigation the other way);
 * the third alternation within the window is the loop's signature.
 *
 * But only when the commits *bounce*: a loop's every hop is a pane rewriting
 * its URL *in place* within a beat of the mirrored load it was just sent —
 * a same-document commit, the one kind only mirroring can make endless. A
 * person clicking back and forth between the panes, a redirect, an explicit
 * load: each of those commits a new document, and a page that redirects
 * itself forever loops in any browser, mirrored or not. So a cross-document
 * commit resets the count and only in-place rewrites that follow a mirror
 * accumulate. Time alone could not draw that line: a spec navigates at
 * machine speed, and two quick test navigations followed by a redirect used
 * to trip the breaker, leaving the target on the page it already showed
 * (the sync.spec flake, 2026-09-03).
 */
const LOOP_WINDOW_MS = 3_000
const LOOP_ALTERNATIONS = 2
/**
 * A bounce is the first in-place rewrite a pane commits after a load the bus
 * itself issued into it — a state, not a stopwatch. The first cut of this
 * breaker gave the rewrite 300 ms to arrive; the CI runner's loop hopped
 * every ~330 ms and ran for 15 loads unbroken (2026-09-03). This bound is a
 * backstop only, so that a load left armed by a page that never rewrote is
 * not attributed the user's own in-page click a minute later.
 */
const BOUNCE_MS = 1_500
/** An issued load that has not committed in this long is forgotten. */
const ISSUED_MAX_AGE_MS = 10_000

/** Mirrors scroll offset and navigation between the two panes. */
export function attachSyncBus(
  native: NativePane,
  target: TargetSource,
  onUrlChanged: (url: string) => void,
): SyncBus {
  /**
   * Every URL we (or an explicit `navigate`) sent into each pane and have
   * not seen commit, with when it was sent. A pane's commit of one of them
   * is an echo — not news, not a mirror, not a reset — *whichever* of them
   * it is: two mirrored loads can be in flight into one pane at once, and
   * the superseded one still commits. A single "next expected URL" read
   * that commit as a new document and reset the loop count, which is how
   * the loop fixture ran for 252 loads unbroken (2026-09-03). An echo also
   * retires whatever was sent before it, and a new document retires
   * everything: a redirect, a failed load or an aborted navigation must not
   * leave a stale entry that swallows a later genuine navigation. The age
   * bound is the backstop for a load that never commits at all.
   */
  const issued: Record<Pane, Map<string, number>> = { native: new Map(), target: new Map() }
  /**
   * When the bus last issued a load *into* each pane (0: never, or retired
   * by a new document since). The load's own commit and the in-place
   * rewrites after it leave the arm — they are what it is for.
   */
  const armedAt: Record<Pane, number> = { native: 0, target: 0 }
  let lastReported = ''
  let lastMirror: { from: Pane; at: number } | null = null
  /** Consecutive direction reversals within `LOOP_WINDOW_MS` of each other. */
  let alternations = 0
  /** One line per loop episode, not per hop: reset with the count. */
  let loopWarned = false

  /** Takes `url` out of the pane's issued set, and everything sent before it; false if it was not there. */
  function retire(pane: Pane, url: string, now: number): boolean {
    const sent = issued[pane].get(url)
    for (const [u, at] of issued[pane]) {
      if ((sent !== undefined && at <= sent) || now - at > ISSUED_MAX_AGE_MS) issued[pane].delete(u)
    }
    return sent !== undefined
  }

  function mirror(from: Pane, url: string, inPage: boolean): void {
    const now = Date.now()
    const echo = retire(from, url, now)
    // Report every commit except the echo of one already reported — the
    // second pane committing the URL the first one was mirrored to (or both
    // panes committing an explicit `navigate`). A same-URL commit that is not
    // an echo is still news: Electron emits no `did-navigate` for a committed
    // error page, so the Back that returns from one lands on the URL last
    // reported, and the renderer clears its load-error badge on that report.
    if (url !== lastReported || !echo) {
      lastReported = url
      onUrlChanged(url)
    }
    if (echo) return

    const to: Pane = from === 'native' ? 'target' : 'native'
    const other = from === 'native' ? target : native
    // A new document in this pane supersedes whatever was still in flight
    // into it, and disarms it: only what the bus sends from here on counts.
    if (!inPage) {
      issued[from].clear()
      armedAt[from] = 0
    }
    if (other.webContents.isDestroyed() || other.webContents.getURL() === url) return

    // Only a bounce accumulates; anything else starts the count afresh.
    // Same-direction mirrors leave the count alone: a mirrored load commits
    // twice when the page rewrites its URL, and otherwise only a quiet
    // window resets.
    const armed = armedAt[from]
    const bounced = inPage && armed !== 0 && now - armed < BOUNCE_MS
    if (!bounced || !lastMirror || now - lastMirror.at >= LOOP_WINDOW_MS) {
      // A fresh count is a fresh episode: the next loop gets its own line.
      alternations = 0
      loopWarned = false
    } else if (lastMirror.from === to) alternations++
    // A dropped attempt is recorded too, so a loop that keeps committing stays
    // broken until it has been quiet for the whole window.
    lastMirror = { from, at: now }
    if (alternations >= LOOP_ALTERNATIONS) {
      if (!loopWarned) {
        loopWarned = true
        log.warn(`navigation mirror loop broken (${from} -> ${to}: ${url})`)
      }
      return
    }

    issued[to].set(url, now)
    armedAt[to] = now
    void other.load(url)
  }

  const onNativeNav = (_e: Electron.Event, url: string): void => mirror('native', url, false)
  const onNativeNavInPage = (_e: Electron.Event, url: string, isMainFrame: boolean): void => {
    if (isMainFrame) mirror('native', url, true)
  }
  const onTargetNav = (url: string, inPage: boolean): void => mirror('target', url, inPage)

  native.webContents.on('did-navigate', onNativeNav)
  native.webContents.on('did-navigate-in-page', onNativeNavInPage)
  target.on('url-changed', onTargetNav)

  return {
    expect(url: string): void {
      const now = Date.now()
      issued.native.set(url, now)
      issued.target.set(url, now)
    },
    // This channel is driven by the sync preload inside the two *page*
    // webContents, never by the app's own renderer, so the sender check here
    // is the inverse of `registerIpc`'s: accept exactly the two panes and
    // route to the other one. The manager has already resolved the sender to
    // this session, but the check stays — it is what picks the *other* pane,
    // and a sender belonging to neither is still dropped rather than guessed.
    // The payload comes from a preload running alongside a third-party page,
    // so it is parsed like any renderer message.
    onScroll(e: IpcMainEvent, raw: unknown): void {
      const other =
        e.sender === native.webContents
          ? target.webContents
          : e.sender === target.webContents
            ? native.webContents
            : null
      if (!other || other.isDestroyed()) return
      const pos = parseScrollPos(raw)
      if (!pos) return
      other.send(IPC.applyScroll, pos)
    },
    detach(): void {
      target.off('url-changed', onTargetNav)
      if (!native.webContents.isDestroyed()) {
        native.webContents.off('did-navigate', onNativeNav)
        native.webContents.off('did-navigate-in-page', onNativeNavInPage)
      }
    },
  }
}
