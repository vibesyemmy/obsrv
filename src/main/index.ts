import { app } from 'electron'
import type { AppContext } from './context'
import { registerIpc, TOOLBAR_H } from './ipc'
import { installMenu } from './menu'
import { Overlay } from './overlay'
import { TabManager } from './tabs'
import { exposeForTests } from './testHooks'
import { createMainWindow } from './window'

function boot(): void {
  const win = createMainWindow()

  // The manager builds its first session, attaches the one frame bus to it and
  // installs the single sender-routed `ipcMain` listener. Everything a pane
  // reports back to the renderer is wired there too, gated on the reporting
  // session being the one in front.
  const tabs = new TabManager(win)
  // Created after the manager, so its view is added after the first tab's
  // native pane and therefore starts on top. `show` re-raises it anyway, for
  // the panes added by later tabs.
  const overlay = new Overlay(win)
  const ctx: AppContext = { win, tabs, bus: tabs.bus, toolbarH: TOOLBAR_H, overlay }

  // Request/response channels, the host-display watch and the native-pane
  // layout fallback all live in `registerIpc`.
  const stopIpc = registerIpc(ctx)
  installMenu(ctx)

  // The offscreen targets are real BrowserWindows, so they must go before the
  // main window finishes closing — otherwise `window-all-closed` never fires
  // and the app hangs after the last visible window is gone.
  //
  // The order is load-bearing. Chromium keeps the window's `webContents` alive
  // for tens of milliseconds after this event, and the renderer goes on
  // reporting its state throughout — into handlers that read the sessions
  // `destroy()` is about to take away. Stopping the listeners first is what
  // makes the destroy safe; the other way round the app quits by crashing
  // (see `registerIpc`).
  win.on('close', () => {
    stopIpc()
    tabs.destroy()
    // Last, and after the sessions: this is the teardown the app's exit depends
    // on least, so it must not stand between the listeners going quiet and the
    // offscreen windows going away.
    overlay.destroy()
  })

  exposeForTests(ctx)
}

// The target canvas is WebGL, and a GPU-process death (a driver reset, a dock
// or display change, memory pressure) loses every WebGL context in the app.
// Chromium restores a context after one reset; after the second it blocks
// WebGL for the renderer's *domain* for the rest of the session — a policy
// written for a browser, where a page gets an infobar with a button that
// lifts the block. Electron has neither the infobar nor the API, so the block
// would hold until relaunch and the target pane would stay white. Off, then:
// one bundle on one file: URL is not a hostile origin that needs sandboxing
// from the GPU. Chromium's own crash limit (three, then software compositing)
// still stands, and the canvas reports that case honestly.
app.commandLine.appendSwitch('disable-domain-blocking-for-3d-apis')

// The evidence a "target went blank" report needs and never has: whether the
// GPU process died, and why Chromium says it did.
app.on('child-process-gone', (_e, details) => {
  if (details.type !== 'GPU') return
  console.warn(`obsrv: GPU process gone (${details.reason}, exit code ${details.exitCode})`)
})

void app.whenReady().then(boot)
app.on('window-all-closed', () => app.quit())
