import { app, type BrowserWindow } from 'electron'
import { IPC } from '../shared/ipc'
import type { AppContext } from './context'
import { readAppVersion, registerIpc, TOOLBAR_H } from './ipc'
import { initLog, log } from './log'
import { installMenu } from './menu'
import { Overlay } from './overlay'
import { TabManager } from './tabs'
import { exposeForTests } from './testHooks'
import { createMainWindow } from './window'

// First, so everything below has somewhere to write.
const logFile = initLog()

// Both panes are Chrome, and say so. Electron's default user agent is
// Chrome's with an `Electron/x.y.z` token added, and that token is what
// Google and Microsoft refuse sign-in to ("this browser or app may not be
// secure"), which made any app with "Sign in with Google" untestable here.
// Set once, before any window exists: every webContents inherits it, and
// the target reads its desktop UA from its own webContents. The mobile UA
// is a fixed string and never carried the token.
app.userAgentFallback = app.userAgentFallback.replace(/ Electron\/\S+/, '')
log.info(
  `obsrv ${readAppVersion()} starting: electron ${process.versions.electron}, chrome ${process.versions.chrome}, ${process.platform} ${process.arch}${app.isPackaged ? '' : ', unpackaged'}`,
)

/** The one visible window, for a second launch to bring to the front. */
let mainWin: BrowserWindow | null = null
/** How many second launches were refused this run; read by the e2e harness. */
let secondInstances = 0

function boot(): void {
  const win = createMainWindow()
  mainWin = win
  win.webContents.on('render-process-gone', (_e, d) => {
    log.error(`shell renderer gone (${d.reason}, exit code ${d.exitCode})`)
  })

  // The manager builds its first session, attaches the one frame bus to it and
  // installs the single sender-routed `ipcMain` listener. Everything a pane
  // reports back to the renderer is wired there too, gated on the reporting
  // session being the one in front.
  const tabs = new TabManager(win)
  // Created after the manager, so its view is added after the first tab's
  // native pane and therefore starts on top. `show` re-raises it anyway, for
  // the panes added by later tabs.
  const overlay = new Overlay(win)
  const ctx: AppContext = { win, tabs, bus: tabs.bus, toolbarH: TOOLBAR_H, overlay, logFile }

  // Nobody is looking at a hidden window, so the active target stops
  // rasterising while it is one. macOS sends `hide`/`show` for occlusion as
  // well as for the Dock, so a window entirely behind another app's counts.
  // Logged on change only — occlusion can flap — and logged at all because
  // the transitions are the evidence for "it hangs when I come back".
  const setVisible = (visible: boolean): void => {
    if (!tabs.setShellVisible(visible)) return
    log.info(visible ? 'window shown; target rasterisation resumed' : 'window hidden; target rasterisation paused')
    // The renderer's stall watchdog has to know: a paused target owes no
    // frame, and the shell's own page visibility does not reflect any of
    // this (measured: it stays `visible` through hide and minimise).
    if (!win.isDestroyed()) win.webContents.send(IPC.targetPaused, !visible)
  }
  win.on('hide', () => setVisible(false))
  win.on('minimize', () => setVisible(false))
  win.on('show', () => setVisible(true))
  win.on('restore', () => setVisible(true))

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
    log.info('closing: main window; sessions going down')
    stopIpc()
    tabs.destroy()
    // Last, and after the sessions: this is the teardown the app's exit depends
    // on least, so it must not stand between the listeners going quiet and the
    // offscreen windows going away.
    overlay.destroy()
    log.info('closed: sessions down')
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

// The evidence a "target went blank" report needs and never had: which
// process died, and why Chromium says it did. The GPU is the one that
// matters, and the one that is warned about.
app.on('child-process-gone', (_e, d) => {
  const line = `${d.type} process gone (${d.reason}, exit code ${d.exitCode}${d.name ? `, ${d.name}` : ''})`
  if (d.type === 'GPU') log.warn(line)
  else log.info(line)
})

// What Chromium decided about this machine's GPU, at the top of the file a
// "target went blank" report will be read from. Not read at `ready`: the GPU
// process has not reported by then and the answer is placeholders (measured:
// "disabled_software, disabled_off" at boot, "enabled, enabled" milliseconds
// later, which is what 0.18.3 wrote). Logged on every change instead, so the
// first line is the real verdict and a later fall-back to software
// compositing — Chromium's answer to a third GPU crash — is on record too.
let gpuLine = ''
app.on('gpu-info-update', () => {
  const gpu = app.getGPUFeatureStatus()
  const line = `gpu: compositing ${gpu.gpu_compositing}, webgl ${gpu.webgl}`
  if (line === gpuLine) return
  gpuLine = line
  log.info(line)
})

// One Obsrv per profile. A second launch used to start a rival agent-control
// server and overwrite the discovery file, so an agent would drive the window
// that started last while the user watched the other (seen 2026-09-05). The
// lock is keyed on the userData path, so the e2e harness's throwaway profiles
// and the CLI's temp profile never contend with a running app. The loser
// exits before it has a window; the holder brings its window to the front.
if (!app.requestSingleInstanceLock()) {
  log.info('another Obsrv already owns this profile; handing over to it and exiting')
  app.quit()
} else {
  app.on('second-instance', () => {
    secondInstances++
    if (process.env.OBSRV_TEST === '1') (globalThis as { __obsrvSecondInstances?: number }).__obsrvSecondInstances = secondInstances
    log.info('a second launch was refused; bringing this window to the front')
    const win = mainWin
    if (!win || win.isDestroyed()) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  })
  void app.whenReady().then(boot)
}
app.on('window-all-closed', () => app.quit())

// The quit's milestones are logged so that a report of the app not quitting
// says how far it got: `quitting` (asked to — Cmd-Q, a driver, or the last
// window gone), `closing` and `closed` around the sessions' teardown above,
// and `exiting` (Electron about to end the process). Between `closed` and
// `exiting` Chromium tears down its own processes, the one stretch this code
// does not own. `window-all-closed` is not a milestone: Electron skips it
// when the windows close because of `app.quit()`.
app.on('before-quit', () => log.info('quitting'))
app.on('will-quit', () => log.info('exiting'))
