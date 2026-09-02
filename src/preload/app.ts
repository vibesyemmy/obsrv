import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { FrameMessage, MenuRequest, ObsrvApi, TabReport } from '../shared/api'
import type { AgentApplyPatch } from '../shared/control'
import { IPC } from '../shared/ipc'
import type { HistoryEntry } from '../shared/history'
import type { TabSnapshot } from '../shared/tabList'
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
  relaunch: () => ipcRenderer.send(IPC.relaunch),
  log: message => ipcRenderer.send(IPC.log, message),
  onTargetPaused: cb => subscribe<boolean>(IPC.targetPaused, cb),
  inspect: point => ipcRenderer.invoke(IPC.inspect, point),
  back: () => ipcRenderer.send(IPC.back),
  forward: () => ipcRenderer.send(IPC.forward),
  setViewport: (width, height, deviceScaleFactor, mobile) =>
    ipcRenderer.invoke(IPC.setViewport, width, height, deviceScaleFactor, mobile),
  setNativeBounds: rect => ipcRenderer.send(IPC.setNativeBounds, rect),
  setNativeVisible: visible => ipcRenderer.send(IPC.setNativeVisible, visible),
  setNativeObscured: obscured => ipcRenderer.send(IPC.setNativeObscured, obscured),
  openMenu: request => ipcRenderer.invoke(IPC.menuOpen, request),
  onMenuShow: fn => {
    const h = (_e: unknown, request: MenuRequest): void => fn(request)
    ipcRenderer.on(IPC.menuShow, h)
    return () => ipcRenderer.off(IPC.menuShow, h)
  },
  pickMenu: value => ipcRenderer.send(IPC.menuPick, value),
  setMode: mode => ipcRenderer.send(IPC.setMode, mode),
  sendInput: ev => ipcRenderer.send(IPC.sendInput, ev),
  getHostInfo: () => ipcRenderer.invoke(IPC.getHostInfo),
  getSettings: () => ipcRenderer.invoke(IPC.getSettings),
  setSettings: s => ipcRenderer.invoke(IPC.setSettings, s),
  onFrame: subscribeFrames,
  // Each of these names the tab it describes: main no longer gates them on the
  // tab being in front, so a background tab keeps its own strip entry current
  // without touching the address bar of the tab that is showing.
  onUrlChanged: cb => subscribe<TabReport & { url: string }>(IPC.urlChanged, cb),
  onTitleChanged: cb => subscribe<TabReport & { title: string }>(IPC.titleChanged, cb),
  onLoadError: cb => subscribe<TabReport & { error: LoadError }>(IPC.loadError, cb),
  onHostChanged: cb => subscribe<HostInfo>(IPC.hostChanged, cb),
  onTargetLoading: cb => subscribe<TabReport & { loading: boolean }>(IPC.targetLoading, cb),
  onNativeFocused: cb => subscribe<TabReport>(IPC.nativeFocused, cb),
  onTargetNavigating: cb => subscribe<TabReport>(IPC.targetNavigating, cb),
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
  getTabs: () => ipcRenderer.invoke(IPC.getTabs),
  addTab: () => ipcRenderer.invoke(IPC.addTab),
  closeTab: id => ipcRenderer.send(IPC.closeTab, id),
  activateTab: id => ipcRenderer.send(IPC.activateTab, id),
  onTabsChanged: cb => subscribe<TabSnapshot>(IPC.tabsChanged, cb),
}

contextBridge.exposeInMainWorld('obsrv', api)
