import { app } from 'electron'
import { IPC } from '../shared/ipc'
import type { AppContext } from './context'
import { attachFrameBus } from './frameBus'
import { NativePane } from './nativePane'
import { TargetSource } from './targetSource'
import { exposeForTests } from './testHooks'
import { createMainWindow } from './window'

/** Toolbar height reserved at the top of the window; panes sit below it. */
const TOOLBAR_H = 44

/**
 * Placeholder layout: left half of the window below the toolbar. The renderer
 * takes over via IPC `setNativeBounds` once the toolbar and panes exist.
 */
function layout(ctx: AppContext): void {
  const [w = 0, h = 0] = ctx.win.getContentSize()
  ctx.native.setBounds({
    x: 0,
    y: TOOLBAR_H,
    width: Math.floor(w / 2),
    height: Math.max(0, h - TOOLBAR_H),
  })
}

function boot(): void {
  const win = createMainWindow()
  const native = new NativePane(win, {
    onUrlChanged: url => {
      if (!win.isDestroyed()) win.webContents.send(IPC.urlChanged, url)
    },
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

  const ctx: AppContext = { win, native, target, bus }
  layout(ctx)
  win.on('resize', () => layout(ctx))

  // The offscreen target is a real BrowserWindow, so it must go before the main
  // window finishes closing — otherwise `window-all-closed` never fires and the
  // app hangs after the last visible window is gone.
  win.on('close', () => {
    bus.detach()
    target.destroy()
  })

  void native.load('about:blank')
  // The target loads its own about:blank in its constructor (it must own its
  // first navigation — see TargetSource.firstNavigation).

  exposeForTests(ctx)
}

void app.whenReady().then(boot)
app.on('window-all-closed', () => app.quit())
