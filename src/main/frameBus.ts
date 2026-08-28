import {
  ipcMain,
  type BrowserWindow,
  type Event,
  type IpcMainEvent,
  type WebContentsDidStartNavigationEventParams,
} from 'electron'
import type { FrameMessage } from '../shared/api'
import { IPC } from '../shared/ipc'
import type { TargetSource } from './targetSource'

export interface FrameBus {
  detach(): void
  /** Image mode stops target frames from overwriting the canvas texture. */
  setEnabled(enabled: boolean): void
  /**
   * Points the bus at a different target — tab activation. The previous
   * source is unsubscribed and the new one invalidated, so the canvas is
   * filled by a full frame immediately rather than waiting for the new page
   * to happen to repaint.
   */
  setSource(next: TargetSource): void
}

/**
 * Ships 1x frames from the offscreen target to the renderer.
 *
 * Delivery is gated on a handshake the renderer starts: the preload sends
 * `frameSubscribe` when its first `onFrame` subscriber appears, and only then
 * does the bus open. Whenever delivery (re)opens — that handshake, or leaving
 * image mode — the target is invalidated so a full frame arrives at once.
 * Opening on `did-finish-load` instead would race the React tree: the
 * invalidate's paint can be sent before any listener exists, and for a static
 * page that paint is often the only one — the canvas would stay blank.
 *
 * The gate closes when the main frame starts a cross-document navigation —
 * the preload module, and with it every subscriber, is about to be torn down,
 * and the reloaded page re-subscribes on its own. `did-start-navigation`
 * filtered to the main frame is used rather than `did-start-loading`: the
 * latter also fires for subframe loads, which would shut the gate with nobody
 * left to reopen it.
 *
 * Throttling belongs to `TargetSource` (`setFrameRate`), not here.
 *
 * There is one canvas in the renderer, so there is one bus. Tab activation
 * re-points it with `setSource` rather than standing up a second one: two
 * buses would both hold the same `frameSubscribe` handshake and the same
 * window, and the background one would keep overwriting the foreground tab's
 * pixels.
 */
export function attachFrameBus(target: TargetSource, win: BrowserWindow): FrameBus {
  let ready = false
  let enabled = true
  // The current source, not the constructor argument: every later read has to
  // follow `setSource`, and closing over `target` is how that silently fails.
  let source = target

  const gone = (): boolean => win.isDestroyed() || win.webContents.isDestroyed()

  const onFrame = (msg: FrameMessage): void => {
    if (!ready || !enabled || gone()) return
    win.webContents.send(IPC.frame, msg)
  }

  const onSubscribe = (e: IpcMainEvent): void => {
    if (gone() || e.sender !== win.webContents) return
    ready = true
    if (enabled) source.invalidate()
  }

  const onRendererGone = (details: Event<WebContentsDidStartNavigationEventParams>): void => {
    if (details.isMainFrame && !details.isSameDocument) ready = false
  }

  const bind = (next: TargetSource): void => {
    source.off('frame', onFrame)
    source = next
    source.on('frame', onFrame)
  }

  source.on('frame', onFrame)
  ipcMain.on(IPC.frameSubscribe, onSubscribe)
  win.webContents.on('did-start-navigation', onRendererGone)

  return {
    detach(): void {
      ready = false
      source.off('frame', onFrame)
      ipcMain.removeListener(IPC.frameSubscribe, onSubscribe)
      if (!gone()) win.webContents.off('did-start-navigation', onRendererGone)
    },
    setEnabled(next: boolean): void {
      enabled = next
      if (enabled && ready) source.invalidate()
    },
    // Deliberately not short-circuited when `next` is already the source:
    // unbind-then-rebind is idempotent, and the identity guard would hide the
    // one failure this has to rule out — a `bind` that subscribes without
    // unsubscribing, which stacks listeners and delivers every paint twice.
    setSource(next: TargetSource): void {
      bind(next)
      if (ready && enabled) next.invalidate()
    },
  }
}
