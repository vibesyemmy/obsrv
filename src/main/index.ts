import { app } from 'electron'
import { IPC } from '../shared/ipc'
import type { AppContext } from './context'
import { attachFrameBus } from './frameBus'
import { registerIpc } from './ipc'
import { NativePane } from './nativePane'
import { attachSyncBus } from './syncBus'
import { TargetSource } from './targetSource'
import { exposeForTests } from './testHooks'
import { createMainWindow } from './window'

function boot(): void {
  const win = createMainWindow()

  // These forwards live here rather than in `registerIpc` because `NativePane`
  // takes its callbacks at construction time. Each is guarded: a pane can still
  // report a navigation or an error while the main window is closing.
  const native = new NativePane(win, {
    onLoadError: err => {
      if (!win.isDestroyed()) win.webContents.send(IPC.loadError, err)
    },
  })

  const target = new TargetSource()
  target.on('load-error', err => {
    if (!win.isDestroyed()) win.webContents.send(IPC.loadError, err)
  })
  target.on('loading', loading => {
    if (!win.isDestroyed()) win.webContents.send(IPC.targetLoading, loading)
  })

  const bus = attachFrameBus(target, win)
  // SyncBus owns URL reporting for both panes, so the URL bar sees exactly one
  // update per navigation whichever pane started it.
  const sync = attachSyncBus(native, target, url => {
    if (!win.isDestroyed()) win.webContents.send(IPC.urlChanged, url)
  })
  const ctx: AppContext = { win, native, target, bus, sync }

  // Request/response channels, the host-display watch and the native-pane
  // layout fallback all live in `registerIpc`.
  registerIpc(ctx)

  // The offscreen target is a real BrowserWindow, so it must go before the main
  // window finishes closing — otherwise `window-all-closed` never fires and the
  // app hangs after the last visible window is gone.
  win.on('close', () => {
    sync.detach()
    bus.detach()
    target.destroy()
  })

  // The target loads its own about:blank in its constructor (it must own its
  // first navigation — see TargetSource.firstNavigation), so this is a
  // deliberate double load like any `navigate`: announce it, or whichever
  // pane commits first mirrors a pointless about:blank into the other.
  sync.expect('about:blank')
  void native.load('about:blank')

  exposeForTests(ctx)
}

void app.whenReady().then(boot)
app.on('window-all-closed', () => app.quit())
