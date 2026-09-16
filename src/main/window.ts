import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'

/**
 * The dev lane's app (README, "Developing: the dev lane") says so in its
 * title bar, so it is never taken for the installed Obsrv running beside it.
 */
function devLaneTitle(): string | null {
  const lane = process.env.OBSRV_DEV_LANE
  return lane ? `Obsrv — dev lane (${process.env.OBSRV_DEV_LANE_LABEL ?? lane})` : null
}

/**
 * Shows the window. Under the e2e harness it shows it without activating the
 * app: `show()` on macOS makes the app the front one, and a suite that
 * launches the app hundreds of times a day on the machine someone is working
 * at took their desk on every launch (bug-e2e-takes-the-desk).
 * `showInactive()` still orders the window on screen, so the window server,
 * and the hide/show events Electron derives from occlusion, see it as before.
 */
export function showWindow(win: BrowserWindow): void {
  if (showsInactive()) {
    // Never key. `showInactive()` still orders the window above the apps
    // someone is working in, and the OS can hand it key focus, which activates
    // the app. That happened 8 times in a recorded full run while the user
    // worked (2026-09-16, 20:31 WAT): each time `browser-window-focus` fired at
    // the same instant as `did-become-active`, and no call from the app came
    // before. Set before the show, so the window is never key for a moment.
    // Nothing under the harness needs a key window: the suite has run with
    // none since #105, and the specs that need one launch with
    // OBSRV_TEST_TAKES_THE_DESK, which takes the other branch.
    win.setFocusable(false)
    win.showInactive()
    // Click-through, too, so a click meant for the app underneath passes
    // through (#107). Test input arrives through the driver, not the OS.
    win.setIgnoreMouseEvents(true)
  } else win.show()
}

/**
 * Whether the app must not activate itself: under the e2e harness, and for a
 * real launch a test makes without the harness (the dev lane's spec), which
 * says so with `OBSRV_SHOW_INACTIVE=1`.
 *
 * A harness app launched with `OBSRV_TEST_TAKES_THE_DESK=1` activates as a
 * user's would. It is for what only a focused window can show, such as the
 * overlay's keyboard focus hand-off (bug-overlay-focus-handoff-untested), and
 * a spec that asks for it runs on CI, or locally only with OBSRV_E2E_FRONT=1.
 */
export function showsInactive(): boolean {
  if (process.env.OBSRV_TEST === '1') return process.env.OBSRV_TEST_TAKES_THE_DESK !== '1'
  return process.env.OBSRV_SHOW_INACTIVE === '1'
}

export function createMainWindow(): BrowserWindow {
  const devTitle = devLaneTitle()
  const win = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 900,
    minHeight: 600,
    title: devTitle ?? 'Obsrv',
    backgroundColor: '#111111',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/app.js'),
      contextIsolation: true,
      sandbox: true,
    },
  })

  win.once('ready-to-show', () => showWindow(win))
  // The page's own <title> would replace it on load.
  if (devTitle !== null) win.on('page-title-updated', e => e.preventDefault())

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL)
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))

  return win
}
