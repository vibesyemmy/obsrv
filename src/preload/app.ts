import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { FrameMessage, ObsrvApi } from '../shared/api'
import type { AgentApplyPatch } from '../shared/control'
import { IPC } from '../shared/ipc'
import type { HistoryEntry } from '../shared/history'
import type { HostInfo, LoadError, UpdateState } from '../shared/types'

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
  setViewport: (width, height, deviceScaleFactor) =>
    ipcRenderer.invoke(IPC.setViewport, width, height, deviceScaleFactor),
  setNativeBounds: rect => ipcRenderer.send(IPC.setNativeBounds, rect),
  setNativeVisible: visible => ipcRenderer.send(IPC.setNativeVisible, visible),
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
  onNativeFocused: cb => {
    const listener = (): void => cb()
    ipcRenderer.on(IPC.nativeFocused, listener)
    return () => {
      ipcRenderer.removeListener(IPC.nativeFocused, listener)
    }
  },
  onTargetNavigating: cb => {
    const listener = (): void => cb()
    ipcRenderer.on(IPC.targetNavigating, listener)
    return () => {
      ipcRenderer.removeListener(IPC.targetNavigating, listener)
    }
  },
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
  onOpenImagePath: cb => subscribe<string>(IPC.openImagePath, cb),
  readImageFile: path => ipcRenderer.invoke(IPC.readImageFile, path),
  reportUiState: s => ipcRenderer.send(IPC.uiState, s),
  onAgentApply: cb => subscribe<AgentApplyPatch>(IPC.agentApply, cb),
  onAgentActivity: cb => {
    const listener = (): void => cb()
    ipcRenderer.on(IPC.agentActivity, listener)
    return () => {
      ipcRenderer.removeListener(IPC.agentActivity, listener)
    }
  },
  getUpdate: () => ipcRenderer.invoke(IPC.getUpdate),
  checkUpdate: () => ipcRenderer.invoke(IPC.checkUpdate),
  openRelease: () => ipcRenderer.invoke(IPC.openRelease),
  onUpdateStatus: cb => subscribe<UpdateState>(IPC.updateStatus, cb),
  getHistory: () => ipcRenderer.invoke(IPC.getHistory),
  clearHistory: () => ipcRenderer.invoke(IPC.clearHistory),
  onHistoryChanged: cb => subscribe<HistoryEntry[]>(IPC.historyChanged, cb),
}

contextBridge.exposeInMainWorld('obsrv', api)
