import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { FrameMessage, ObsrvApi } from '../shared/api'
import { IPC } from '../shared/ipc'

/** Task 10 widens this to the full `ObsrvApi`. */
type FrameApi = Pick<ObsrvApi, 'onFrame'>

/**
 * Live `onFrame` subscribers. Main only ships frames to a renderer that has
 * asked for them: the first subscriber (every 0→1 transition, including after
 * a reload, which resets this module) sends `frameSubscribe`, and main answers
 * with a full frame. Tying the handshake to the subscription rather than to
 * `did-finish-load` closes the gap in which a frame could be sent before the
 * React tree has mounted its listener — for a static target that frame is
 * often the only one.
 */
let frameSubscribers = 0

const api: FrameApi = {
  onFrame(cb: (m: FrameMessage) => void): () => void {
    const listener = (_e: IpcRendererEvent, m: FrameMessage): void => cb(m)
    ipcRenderer.on(IPC.frame, listener)
    if (++frameSubscribers === 1) ipcRenderer.send(IPC.frameSubscribe)
    let active = true
    return () => {
      if (!active) return
      active = false
      frameSubscribers--
      ipcRenderer.removeListener(IPC.frame, listener)
    }
  },
}

contextBridge.exposeInMainWorld('obsrv', api)
