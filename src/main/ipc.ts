import { app, ipcMain, screen, type BrowserWindow, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { join } from 'node:path'
import { IPC } from '../shared/ipc'
import { parseInputEvent, parseMode, parseRect, parseSettings } from '../shared/ipcPayloads'
import { loadSettings, saveSettings } from '../shared/settings'
import type { HostInfo } from '../shared/types'
import { normalizeUrl } from '../shared/url'
import type { AppContext } from './context'

/** Toolbar height reserved at the top of the window; panes sit below it. */
const TOOLBAR_H = 44

/**
 * Physical pixels of the display the window currently sits on. All zeroes mean
 * the display could not be read, and the renderer falls back to S = 2 (spec §9).
 */
function hostInfo(win: BrowserWindow): HostInfo {
  try {
    const d = screen.getDisplayMatching(win.getBounds())
    return {
      physicalWidth: Math.round(d.size.width * d.scaleFactor),
      physicalHeight: Math.round(d.size.height * d.scaleFactor),
      scaleFactor: d.scaleFactor,
    }
  } catch {
    return { physicalWidth: 0, physicalHeight: 0, scaleFactor: 0 }
  }
}

export function registerIpc(ctx: AppContext): void {
  const { win, native, target, bus, sync } = ctx
  const settingsFile = join(app.getPath('userData'), 'settings.json')
  let settings = loadSettings(settingsFile)

  // Only the app's own renderer may drive these channels. The native pane and
  // the target load third-party pages; neither has a preload that reaches
  // these channels today, but the check costs nothing and mirrors the one in
  // `attachFrameBus`. Fire-and-forget channels ignore a foreign sender;
  // request/response ones reject it.
  //
  // Payloads are parsed by `shared/ipcPayloads` before they touch Electron:
  // main must never crash on a renderer message, and a throw inside an
  // `ipcMain.on` listener is an uncaught exception in main. Malformed
  // payloads are dropped; malformed `invoke` arguments reject the call.
  const fromRenderer = (e: IpcMainEvent | IpcMainInvokeEvent): boolean => e.sender === win.webContents
  const assertRenderer = (e: IpcMainInvokeEvent): void => {
    if (!fromRenderer(e)) throw new Error('ipc: unexpected sender')
  }

  // --- navigation: both panes always move together --------------------------
  ipcMain.handle(IPC.navigate, async (e, url: string) => {
    assertRenderer(e)
    // Both panes are being pointed at the same URL on purpose; tell SyncBus so
    // it does not mirror the pair back and trigger a second load. Input that
    // does not normalise never reaches Chromium, so there is nothing to
    // expect; the panes report it as a `LoadError` themselves.
    let wanted = url
    try {
      wanted = normalizeUrl(url)
      sync.expect(wanted)
    } catch {
      // Reported by `native.load` / `target.load` below.
    }
    const [applied] = await Promise.all([native.load(wanted), target.load(wanted)])
    return applied
  })
  ipcMain.on(IPC.reload, e => {
    if (!fromRenderer(e)) return
    native.reload()
    target.reload()
  })
  ipcMain.on(IPC.back, e => {
    if (!fromRenderer(e)) return
    native.back()
    target.back()
  })
  ipcMain.on(IPC.forward, e => {
    if (!fromRenderer(e)) return
    native.forward()
    target.forward()
  })

  // --- target ---------------------------------------------------------------
  ipcMain.handle(IPC.setViewport, (e, width: number, height: number) => {
    assertRenderer(e)
    const v = target.setViewport(width, height)
    return { width: v.width, height: v.height }
  })
  ipcMain.on(IPC.sendInput, (e, raw: unknown) => {
    if (!fromRenderer(e)) return
    const ev = parseInputEvent(raw)
    if (!ev) return
    try {
      target.sendInput(ev)
    } catch {
      // Electron rejected a well-formed event (e.g. a keyCode it cannot map);
      // the input is lost, the app is not.
    }
  })

  // --- mode -----------------------------------------------------------------
  ipcMain.on(IPC.setMode, (e, raw: unknown) => {
    if (!fromRenderer(e)) return
    const mode = parseMode(raw)
    if (!mode) return
    const live = mode === 'url'
    native.setVisible(live)
    bus.setEnabled(live)
  })

  // --- native pane layout ---------------------------------------------------
  // Main positions the view until the renderer's pane layout exists. The first
  // `setNativeBounds` hands ownership over for the rest of the run, so the two
  // never fight over the same view.
  let rendererDrivesLayout = false
  const fallbackLayout = (): void => {
    if (rendererDrivesLayout) return
    const [w = 0, h = 0] = win.getContentSize()
    native.setBounds({
      x: 0,
      y: TOOLBAR_H,
      width: Math.floor(w / 2),
      height: Math.max(0, h - TOOLBAR_H),
    })
  }
  fallbackLayout()
  win.on('resize', fallbackLayout)
  ipcMain.on(IPC.setNativeBounds, (e, raw: unknown) => {
    if (!fromRenderer(e)) return
    const rect = parseRect(raw)
    if (!rect) return
    native.setBounds(rect)
    // Ownership passes only once a rect has actually been applied.
    rendererDrivesLayout = true
  })

  // --- host display ---------------------------------------------------------
  ipcMain.handle(IPC.getHostInfo, e => {
    assertRenderer(e)
    return hostInfo(win)
  })

  let lastHost = JSON.stringify(hostInfo(win))
  const pushHostIfChanged = (): void => {
    const next = hostInfo(win)
    const key = JSON.stringify(next)
    if (key === lastHost) return
    lastHost = key
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
      win.webContents.send(IPC.hostChanged, next)
    }
  }
  // Dragging the window to a second monitor changes the scale we must divide by.
  win.on('move', pushHostIfChanged)
  screen.on('display-metrics-changed', pushHostIfChanged)
  screen.on('display-added', pushHostIfChanged)
  screen.on('display-removed', pushHostIfChanged)

  // --- settings -------------------------------------------------------------
  ipcMain.handle(IPC.getSettings, e => {
    assertRenderer(e)
    return settings
  })
  ipcMain.handle(IPC.setSettings, (e, raw: unknown) => {
    assertRenderer(e)
    // A non-positive diagonal makes `ppi()` throw; refuse rather than persist
    // it. `parseSettings` also copies only the two known keys, so nothing the
    // renderer adds reaches disk or `getSettings`.
    const s = parseSettings(raw)
    if (!s) throw new Error('invalid settings')
    // Persist first: memory must never hold a value disk refused.
    saveSettings(settingsFile, s)
    settings = s
  })
}
