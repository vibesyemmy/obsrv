import { app, ipcMain, screen, type BrowserWindow, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { readFileSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { CONTROL_FILE_NAME, type AgentApplyPatch, type AgentUiState } from '../shared/control'
import type { Rect } from '../shared/api'
import { IMAGE_EXTENSIONS } from '../shared/fileNav'
import { IPC } from '../shared/ipc'
import { parseDeviceScaleFactor, parseInputEvent, parseMode, parseRect, parseSettings, parseUiState } from '../shared/ipcPayloads'
import { loadSettings, saveSettings } from '../shared/settings'
import type { HostInfo } from '../shared/types'
import { normalizeUrl } from '../shared/url'
import type { AppContext } from './context'
import { ControlServer } from './controlServer'

/** Toolbar height reserved at the top of the window; panes sit below it. */
const TOOLBAR_H = 44

/** Largest design export `readImageFile` will hand to the renderer (encoded bytes). */
export const MAX_IMAGE_FILE_BYTES = 64 * 1024 * 1024

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

  // --- navigation -----------------------------------------------------------
  // An explicit `navigate` drives both panes. History moves (back, forward,
  // reload) drive the native pane only: SyncBus mirrors whatever it commits
  // into the target, whose own history is not user-facing. Driving both would
  // race the mirror — the target's back is aborted by the mirrored `load` and
  // the two histories drift apart.
  //
  // Shared with the agent-control server, which must navigate through exactly
  // this path — never a parallel one.
  const navigateBoth = async (url: string): Promise<string> => {
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
  }
  ipcMain.handle(IPC.navigate, (e, url: string) => {
    assertRenderer(e)
    return navigateBoth(url)
  })
  // The toolbar's history/reload actions, shared verbatim with the
  // agent-control server's back/forward/reload commands.
  const reloadBoth = (): void => {
    native.reload()
    // A reload commits the URL the target already shows, so the mirror
    // (rightly) does nothing; reload the target on its own.
    target.reload()
  }
  const goBack = (): void => native.back()
  const goForward = (): void => native.forward()
  ipcMain.on(IPC.reload, e => {
    if (!fromRenderer(e)) return
    reloadBoth()
  })
  ipcMain.on(IPC.back, e => {
    if (!fromRenderer(e)) return
    goBack()
  })
  ipcMain.on(IPC.forward, e => {
    if (!fromRenderer(e)) return
    goForward()
  })

  // --- target ---------------------------------------------------------------
  ipcMain.handle(IPC.setViewport, (e, width: number, height: number, rawDsf: unknown) => {
    assertRenderer(e)
    // Width and height survive any garbage (clampViewport sanitises), but a
    // bad scale factor would decide the offscreen window's raster density —
    // refuse it rather than guess.
    const dsf = parseDeviceScaleFactor(rawDsf)
    if (dsf === null) throw new Error('invalid deviceScaleFactor')
    const v = target.setViewport(width, height, dsf)
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
    // it. `parseSettings` also copies only the known keys, so nothing the
    // renderer adds reaches disk or `getSettings`.
    const s = parseSettings(raw)
    if (!s) throw new Error('invalid settings')
    // Persist first: memory must never hold a value disk refused.
    saveSettings(settingsFile, s)
    const wasEnabled = settings.agentControl
    settings = s
    if (s.agentControl !== wasEnabled) applyAgentControl(s.agentControl)
  })

  // --- agent control --------------------------------------------------------
  // The loopback control server (see `controlServer.ts`). `status` answers
  // from a main-side mirror of the renderer's toolbar state, kept fresh by
  // the renderer's `uiState` reports — main never blocks a request on a
  // renderer round-trip. The mirror starts at the store's initial values and
  // the renderer reports on mount, so it is honest before the first change.
  const uiState: AgentUiState = { presetId: '1080p-24', profileId: 'reference', viewMode: '1:1', mode: 'url' }
  // The target pane's window-relative bounds (CSS px), for `captureTarget`.
  // Null until the renderer's first measured report; the capture then falls
  // back to the full window with a warning rather than failing.
  let targetBounds: Rect | null = null
  // A patch sent before the renderer has mounted its listeners would vanish;
  // the first uiState report is the renderer saying "I'm listening", so
  // anything an early agent asked for is queued until then. The queue is
  // bounded — an agent hammering a never-mounting renderer must not grow
  // main's heap — dropping the oldest, which the newest supersedes anyway.
  const MAX_PENDING_APPLIES = 32
  let rendererReported = false
  let warnedPendingOverflow = false
  const pendingApplies: AgentApplyPatch[] = []
  ipcMain.on(IPC.uiState, (e, raw: unknown) => {
    if (!fromRenderer(e)) return
    const s = parseUiState(raw)
    if (!s) return
    const { targetBounds: bounds, ...state } = s
    Object.assign(uiState, state)
    targetBounds = bounds ?? null
    if (!rendererReported) {
      rendererReported = true
      for (const patch of pendingApplies.splice(0)) {
        if (!win.isDestroyed()) win.webContents.send(IPC.agentApply, patch)
      }
    }
  })

  // Unpackaged (dev, e2e) `app.getVersion()` is Electron's own version; the
  // app's version lives in package.json two levels above out/main — the same
  // file inside app.asar when packaged.
  const appVersion = ((): string => {
    try {
      const pkg = JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8')) as { version?: string }
      return pkg.version ?? app.getVersion()
    } catch {
      return app.getVersion()
    }
  })()

  const control = new ControlServer(join(app.getPath('userData'), CONTROL_FILE_NAME), {
    status: () => {
      let url = ''
      try {
        url = target.webContents.getURL()
      } catch {
        // The target is mid-recreation or the app is closing; '' is honest.
      }
      return { version: appVersion, url, ...uiState }
    },
    navigate: navigateBoth,
    apply: patch => {
      if (win.isDestroyed()) return
      if (!rendererReported) {
        if (pendingApplies.length >= MAX_PENDING_APPLIES) {
          if (!warnedPendingOverflow) {
            warnedPendingOverflow = true
            console.warn('obsrv: agent-apply queue full before the renderer mounted; dropping oldest entries')
          }
          pendingApplies.shift()
        }
        pendingApplies.push(patch)
        return
      }
      win.webContents.send(IPC.agentApply, patch)
    },
    captureVisible: async () => {
      const image = await win.webContents.capturePage()
      const size = image.getSize()
      return { data: image.toPNG().toString('base64'), width: size.width, height: size.height }
    },
    captureTarget: async () => {
      // `capturePage(rect)` crops in the same CSS coordinates the renderer
      // measured, so the reported pane rect needs no conversion.
      const bounds = targetBounds
      const known = bounds !== null && bounds.width >= 1 && bounds.height >= 1
      const image = await win.webContents.capturePage(known ? bounds : undefined)
      const size = image.getSize()
      return {
        data: image.toPNG().toString('base64'),
        width: size.width,
        height: size.height,
        warnings: known ? [] : ['the renderer has not reported the target pane bounds yet; captured the full window instead'],
      }
    },
    viewport: () => target.getViewport(),
    scroll: pos => {
      // An agent scroll drives both panes over the same `applyScroll` channel
      // the pane-sync mirror uses — each pane's sync preload applies it and
      // suppresses its own echo, so the two arrive together with no loop.
      // Relying on the mirror instead would be silent: an applied scroll is
      // deliberately not re-reported (see preload/sync.ts).
      for (const wc of [native.webContents, target.webContents]) {
        if (!wc.isDestroyed()) wc.send(IPC.applyScroll, pos)
      }
    },
    click: c => {
      // Built as the wire shape and passed through parseInputEvent, so a
      // remote click reaches `sendInput` exactly as a canvas-forwarded one.
      const down = parseInputEvent({ type: 'mouseDown', x: c.x, y: c.y, button: c.button, clickCount: 1 })
      const up = parseInputEvent({ type: 'mouseUp', x: c.x, y: c.y, button: c.button, clickCount: 1 })
      if (!down || !up) return
      try {
        target.sendInput(down)
        target.sendInput(up)
      } catch {
        // Electron rejected the event; the click is lost, the app is not.
      }
    },
    back: goBack,
    forward: goForward,
    reload: reloadBoth,
    focusWindow: () => {
      if (win.isDestroyed()) return
      win.show()
      win.focus()
    },
    activity: () => {
      if (!win.isDestroyed()) win.webContents.send(IPC.agentActivity)
    },
  })
  const applyAgentControl = (enabled: boolean): void => {
    if (enabled) {
      control.start().catch((e: unknown) => {
        console.error('obsrv: agent-control server failed to start', e)
      })
    } else {
      control.stop()
    }
  }
  // OBSRV_AGENT_CONTROL=1 force-enables the server for this session (the
  // e2e harness uses it). It flips the in-memory setting so the toolbar
  // toggle reflects reality and toggling off works normally; nothing is
  // persisted until the next settings write.
  if (process.env.OBSRV_AGENT_CONTROL === '1') settings = { ...settings, agentControl: true }
  if (settings.agentControl) applyAgentControl(true)
  // The discovery file must not outlive the process; `stop` removes it
  // synchronously before quit proceeds.
  app.on('will-quit', () => control.stop())

  // --- image mode -----------------------------------------------------------
  // The only file read main does for the renderer: a design export dropped on
  // the native pane (see NativePane's will-navigate). Extension and size are
  // checked here, so a page script steering the pane at `file:///…` can at
  // most make the app decode a local image, never read anything else.
  ipcMain.handle(IPC.readImageFile, async (e, raw: unknown) => {
    assertRenderer(e)
    if (typeof raw !== 'string' || !IMAGE_EXTENSIONS.test(raw)) throw new Error('Unsupported file type')
    const { size } = await stat(raw)
    if (size > MAX_IMAGE_FILE_BYTES) {
      throw new Error(`Image file too large (max ${MAX_IMAGE_FILE_BYTES / 1048576} MB)`)
    }
    return readFile(raw)
  })
}
