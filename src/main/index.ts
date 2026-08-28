import { app } from 'electron'
import type { AppContext } from './context'
import { registerIpc, TOOLBAR_H } from './ipc'
import { installMenu } from './menu'
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
  const ctx: AppContext = { win, tabs, bus: tabs.bus, toolbarH: TOOLBAR_H }

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
  })

  exposeForTests(ctx)
}

void app.whenReady().then(boot)
app.on('window-all-closed', () => app.quit())
