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
 * Two mirrors in opposite directions closer together than this are a loop —
 * typically a SPA that rewrites its own URL on load, so each pane's commit
 * differs from the other's and they chase each other forever.
 */
const LOOP_WINDOW_MS = 1_000

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
  let loopWarned = false

  function mirror(from: Pane, url: string): void {
    if (url !== lastReported) {
      lastReported = url
      onUrlChanged(url)
    }
    const expected = pending[from]
    pending[from] = null
    if (expected === url) return

    const to: Pane = from === 'native' ? 'target' : 'native'
    const other = from === 'native' ? target : native
    if (other.webContents.isDestroyed() || other.webContents.getURL() === url) return

    const now = Date.now()
    if (lastMirror && lastMirror.from === to && now - lastMirror.at < LOOP_WINDOW_MS) {
      if (!loopWarned) {
        loopWarned = true
        console.warn(`obsrv: navigation mirror loop broken (${from} -> ${to}: ${url})`)
      }
      return
    }
    lastMirror = { from, at: now }

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
