import { BrowserWindow } from 'electron'
import { join } from 'node:path'

export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 900,
    minHeight: 600,
    title: 'Obsrv',
    backgroundColor: '#111111',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/app.js'),
      contextIsolation: true,
      sandbox: true,
    },
  })

  win.once('ready-to-show', () => win.show())

  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))

  return win
}
