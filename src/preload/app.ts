import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { FrameMessage, ObsrvApi } from '../shared/api'
import { IPC } from '../shared/ipc'
import type { HostInfo, LoadError } from '../shared/types'

/** Wraps `ipcRenderer.on` so every subscriber gets an unsubscribe function. */
function subscribe<T>(channel: string, cb: (v: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, v: T): void => cb(v)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

/**
 * Live `onFrame` subscribers. Main only ships frames to a renderer that has
 * asked for them: the first subscriber (every 0→1 transition, including after
 * a reload, which resets this module) sends `frameSubscribe`, and main answers
 * with a full frame — see `attachFrameBus`.
 */
let frameSubscribers = 0

function subscribeFrames(cb: (m: FrameMessage) => void): () => void {
  const off = subscribe<FrameMessage>(IPC.frame, cb)
  if (++frameSubscribers === 1) ipcRenderer.send(IPC.frameSubscribe)
  let active = true
  return () => {
    if (!active) return
    active = false
    frameSubscribers--
    off()
  }
}

const api: ObsrvApi = {
  navigate: url => ipcRenderer.invoke(IPC.navigate, url),
  reload: () => ipcRenderer.send(IPC.reload),
  back: () => ipcRenderer.send(IPC.back),
  forward: () => ipcRenderer.send(IPC.forward),
  setViewport: (width, height) => ipcRenderer.invoke(IPC.setViewport, width, height),
  setNativeBounds: rect => ipcRenderer.send(IPC.setNativeBounds, rect),
  setMode: mode => ipcRenderer.send(IPC.setMode, mode),
  sendInput: ev => ipcRenderer.send(IPC.sendInput, ev),
  getHostInfo: () => ipcRenderer.invoke(IPC.getHostInfo),
  getSettings: () => ipcRenderer.invoke(IPC.getSettings),
  setSettings: s => ipcRenderer.invoke(IPC.setSettings, s),
  onFrame: subscribeFrames,
  onUrlChanged: cb => subscribe<string>(IPC.urlChanged, cb),
  onLoadError: cb => subscribe<LoadError>(IPC.loadError, cb),
  onHostChanged: cb => subscribe<HostInfo>(IPC.hostChanged, cb),
  onTargetLoading: cb => subscribe<boolean>(IPC.targetLoading, cb),
  onOpenImage: cb => {
    const listener = (): void => cb()
    ipcRenderer.on(IPC.openImage, listener)
    return () => {
      ipcRenderer.removeListener(IPC.openImage, listener)
    }
  },
  onFocusUrl: cb => {
    const listener = (): void => cb()
    ipcRenderer.on(IPC.focusUrl, listener)
    return () => {
      ipcRenderer.removeListener(IPC.focusUrl, listener)
    }
  },
}

contextBridge.exposeInMainWorld('obsrv', api)
