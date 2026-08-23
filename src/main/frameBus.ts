import type { BrowserWindow } from 'electron'
import type { FrameMessage } from '../shared/api'
import { IPC } from '../shared/ipc'
import type { TargetSource } from './targetSource'

export interface FrameBus {
  detach(): void
}

/**
 * Ships 1x frames from the offscreen target to the renderer.
 *
 * Two things it has to get right:
 *
 *  - Nothing is sent before the renderer has finished loading. `send` to a
 *    renderer whose preload has not run yet is dropped silently, and for a
 *    static page the first paint is often the only paint — the canvas would
 *    stay blank forever.
 *  - When the renderer (re)loads, the target is invalidated so the freshly
 *    mounted canvas gets a full frame immediately instead of waiting for the
 *    page to damage itself.
 *
 * Throttling belongs to `TargetSource` (`setFrameRate`), not here.
 */
export function attachFrameBus(target: TargetSource, win: BrowserWindow): FrameBus {
  let ready = false

  const onFrame = (msg: FrameMessage): void => {
    if (!ready || win.isDestroyed() || win.webContents.isDestroyed()) return
    win.webContents.send(IPC.frame, msg)
  }

  const onRendererReady = (): void => {
    ready = true
    target.invalidate()
  }

  const onRendererGone = (): void => {
    ready = false
  }

  target.on('frame', onFrame)
  win.webContents.on('did-finish-load', onRendererReady)
  win.webContents.on('did-start-loading', onRendererGone)

  return {
    detach(): void {
      ready = false
      target.off('frame', onFrame)
      if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
        win.webContents.off('did-finish-load', onRendererReady)
        win.webContents.off('did-start-loading', onRendererGone)
      }
    },
  }
}
