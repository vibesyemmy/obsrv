import { ipcMain, type IpcMainEvent } from 'electron'
import { IPC } from '../shared/ipc'
import { parseScrollPos } from '../shared/ipcPayloads'
import type { NativePane } from './nativePane'
import type { TargetSource } from './targetSource'

export interface SyncBus {
  /**
   * Announce a URL that is deliberately being loaded into both panes, so the
   * resulting pair of `did-navigate` events is not read as a one-sided
   * navigation and mirrored a second time.
   */
  expect(url: string): void
  detach(): void
}

type Pane = 'native' | 'target'

/**
 * Mirrors that keep reversing direction closer together than this are a loop —
 * typically a SPA that rewrites its own URL on load, so each pane's commit
 * differs from the other's and they chase each other forever. One reversal is
 * legitimate (a redirect mirrored one way, then a navigation the other way);
 * the third alternation within the window is the loop's signature.
 */
const LOOP_WINDOW_MS = 1_000
const LOOP_ALTERNATIONS = 2

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
  let lastReported = ''
  let lastMirror: { from: Pane; at: number } | null = null
  /** Consecutive direction reversals within `LOOP_WINDOW_MS` of each other. */
  let alternations = 0
  let loopWarned = false

  function mirror(from: Pane, url: string): void {
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
    // Same-direction mirrors leave the count alone: a mirrored load commits
    // twice when the page rewrites its URL, and only a quiet window resets.
    if (!lastMirror || now - lastMirror.at >= LOOP_WINDOW_MS) alternations = 0
    else if (lastMirror.from === to) alternations++
    // A dropped attempt is recorded too, so a loop that keeps committing stays
    // broken until it has been quiet for the whole window.
    lastMirror = { from, at: now }
    if (alternations >= LOOP_ALTERNATIONS) {
      if (!loopWarned) {
        loopWarned = true
        console.warn(`obsrv: navigation mirror loop broken (${from} -> ${to}: ${url})`)
      }
      return
    }

    pending[to] = url
    void other.load(url)
  }

  const onNativeNav = (_e: Electron.Event, url: string): void => mirror('native', url)
  const onNativeNavInPage = (_e: Electron.Event, url: string, isMainFrame: boolean): void => {
    if (isMainFrame) mirror('native', url)
  }
  const onTargetNav = (url: string): void => mirror('target', url)

  native.webContents.on('did-navigate', onNativeNav)
  native.webContents.on('did-navigate-in-page', onNativeNavInPage)
  target.on('url-changed', onTargetNav)

  // This channel is driven by the sync preload inside the two *page*
  // webContents, never by the app's own renderer, so the sender check here is
  // the inverse of `registerIpc`'s: accept exactly the two panes and route to
  // the other one. The payload comes from a preload running alongside a
  // third-party page, so it is parsed like any renderer message.
  const onScroll = (e: IpcMainEvent, raw: unknown): void => {
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
  }
  ipcMain.on(IPC.syncScroll, onScroll)

  return {
    expect(url: string): void {
      pending.native = url
      pending.target = url
    },
    detach(): void {
      ipcMain.off(IPC.syncScroll, onScroll)
      target.off('url-changed', onTargetNav)
      if (!native.webContents.isDestroyed()) {
        native.webContents.off('did-navigate', onNativeNav)
        native.webContents.off('did-navigate-in-page', onNativeNavInPage)
      }
    },
  }
}
