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

/** Mirrors scroll offset and navigation between the two panes. */
export function attachSyncBus(
  native: NativePane,
  target: TargetSource,
  onUrlChanged: (url: string) => void,
): SyncBus {
  /** URLs already accounted for; their `did-navigate` must not bounce back. */
  const settled = new Set<string>()
  let lastReported = ''

  function mirror(from: 'native' | 'target', url: string): void {
    if (url !== lastReported) {
      lastReported = url
      onUrlChanged(url)
    }
    // Consumed by whichever pane reports first; the second pane then falls out
    // on the URL comparison below.
    if (settled.delete(url)) return

    const other = from === 'native' ? target : native
    if (other.webContents.isDestroyed() || other.webContents.getURL() === url) return

    settled.add(url)
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
      settled.add(url)
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
