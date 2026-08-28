import { app } from 'electron'
import { IPC } from '../shared/ipc'
import type { AppContext } from './context'
import { attachFrameBus } from './frameBus'
import { registerIpc, TOOLBAR_H } from './ipc'
import { installMenu } from './menu'
import { TabSession } from './tabSession'
import { exposeForTests } from './testHooks'
import { createMainWindow } from './window'

function boot(): void {
  const win = createMainWindow()

  // The session owns the pane pair and the sync bus between them. `NativePane`
  // takes its callbacks at construction, so those forwards live in the session;
  // `TargetSource` takes its listeners afterwards, so those stay here.
  const session = new TabSession(win, url => {
    if (!win.isDestroyed()) win.webContents.send(IPC.urlChanged, url)
  })
  const { native, target } = session

  // A click on the native pane is invisible to the renderer: the view is an
  // OS-level overlay, so no DOM event reaches the renderer's document and — in
  // an unfocused window — not even a `blur`. Main can see it, so main says so.
  // The renderer's overflow menu uses this to dismiss itself.
  native.webContents.on('focus', () => {
    if (!win.isDestroyed()) win.webContents.send(IPC.nativeFocused)
  })

  target.on('load-error', err => {
    if (!win.isDestroyed()) win.webContents.send(IPC.loadError, err)
  })
  target.on('loading', loading => {
    if (!win.isDestroyed()) win.webContents.send(IPC.targetLoading, loading)
  })
  target.on('navigating', () => {
    if (!win.isDestroyed()) win.webContents.send(IPC.targetNavigating)
  })

  const bus = attachFrameBus(target, win)
  const ctx: AppContext = { win, session, bus, toolbarH: TOOLBAR_H }

  // Request/response channels, the host-display watch and the native-pane
  // layout fallback all live in `registerIpc`.
  registerIpc(ctx)
  installMenu(ctx)

  // The offscreen target is a real BrowserWindow, so it must go before the main
  // window finishes closing — otherwise `window-all-closed` never fires and the
  // app hangs after the last visible window is gone.
  win.on('close', () => {
    session.sync.detach()
    bus.detach()
    target.destroy()
  })

  // The target loads its own about:blank in its constructor (it must own its
  // first navigation — see TargetSource.firstNavigation), so this is a
  // deliberate double load like any `navigate`: announce it, or whichever
  // pane commits first mirrors a pointless about:blank into the other.
  session.sync.expect('about:blank')
  void native.load('about:blank')

  exposeForTests(ctx)
}

void app.whenReady().then(boot)
app.on('window-all-closed', () => app.quit())
