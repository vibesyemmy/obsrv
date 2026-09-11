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

  win.once('ready-to-show', () => win.show())
  // The page's own <title> would replace it on load.
  if (devTitle !== null) win.on('page-title-updated', e => e.preventDefault())

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL)
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))

  return win
}
