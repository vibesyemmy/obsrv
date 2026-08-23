import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1600,
    height: 1000,
    title: 'Obsrv',
    webPreferences: { preload: join(__dirname, '../preload/app.js'), contextIsolation: true, sandbox: true },
  })
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
}

app.whenReady().then(createWindow)
app.on('window-all-closed', () => app.quit())
