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
const LOOP_WINDOW_MS = 1_000
const LOOP_ALTERNATIONS = 2
/** An in-place rewrite this soon after a mirrored load into the same pane is a bounce. */
const BOUNCE_MS = 300

/** Mirrors scroll offset and navigation between the two panes. */
export function attachSyncBus(
  native: NativePane,
  target: TargetSource,
  onUrlChanged: (url: string) => void,
): SyncBus {
  /**
   * The URL each pane is expected to commit next because we (or an explicit
   * `navigate`) sent it there. A pane's commit always clears its own slot,
   * matching or not: a redirect, a failed load or an aborted navigation must
   * not leave a stale expectation that swallows a later genuine mirror.
   */
  const pending: Record<Pane, string | null> = { native: null, target: null }
  /** When a mirrored load was last issued *into* each pane; a commit soon after is a bounce. */
  const lastMirroredLoadAt: Record<Pane, number> = { native: 0, target: 0 }
  let lastReported = ''
  let lastMirror: { from: Pane; at: number } | null = null
  /** Consecutive direction reversals within `LOOP_WINDOW_MS` of each other. */
  let alternations = 0
  let loopWarned = false

  function mirror(from: Pane, url: string, inPage: boolean): void {
    const expected = pending[from]
    pending[from] = null
    // Report every commit except the echo of one already reported — the
    // second pane committing the URL the first one was mirrored to (or both
    // panes committing an explicit `navigate`). A same-URL commit that is not
    // an echo is still news: Electron emits no `did-navigate` for a committed
    // error page, so the Back that returns from one lands on the URL last
    // reported, and the renderer clears its load-error badge on that report.
    if (url !== lastReported || expected !== url) {
      lastReported = url
      onUrlChanged(url)
    }
    if (expected === url) return

    const to: Pane = from === 'native' ? 'target' : 'native'
    const other = from === 'native' ? target : native
    if (other.webContents.isDestroyed() || other.webContents.getURL() === url) return

    const now = Date.now()
    // Only a bounce accumulates: an in-place rewrite within a beat of a
    // mirrored load into this pane. Anything else — a new document, or a
    // rewrite long after — starts the count afresh. Same-direction mirrors
    // leave the count alone: a mirrored load commits twice when the page
    // rewrites its URL, and otherwise only a quiet window resets.
    const bounced = inPage && now - lastMirroredLoadAt[from] < BOUNCE_MS
    if (!bounced || !lastMirror || now - lastMirror.at >= LOOP_WINDOW_MS) alternations = 0
    else if (lastMirror.from === to) alternations++
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

    pending[to] = url
    lastMirroredLoadAt[to] = now
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
      pending.native = url
      pending.target = url
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
