import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { FrameMessage, ObsrvApi } from '../shared/api'
import { IPC } from '../shared/ipc'

/** Task 10 widens this to the full `ObsrvApi`. */
type FrameApi = Pick<ObsrvApi, 'onFrame'>

const api: FrameApi = {
  onFrame(cb: (m: FrameMessage) => void): () => void {
    const listener = (_e: IpcRendererEvent, m: FrameMessage): void => cb(m)
    ipcRenderer.on(IPC.frame, listener)
    return () => {
      ipcRenderer.removeListener(IPC.frame, listener)
    }
  },
}

contextBridge.exposeInMainWorld('obsrv', api)
