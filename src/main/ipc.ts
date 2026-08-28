import { app, ipcMain, screen, shell, type BrowserWindow, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { readFileSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { CONTROL_FILE_NAME, type AgentApplyPatch, type AgentUiState, type AgentViewMode } from '../shared/control'
import type { Rect } from '../shared/api'
import { IMAGE_EXTENSIONS } from '../shared/fileNav'
import { recordVisit, type HistoryEntry } from '../shared/history'
import { loadHistory, saveHistory } from '../shared/historyFile'
import { IPC } from '../shared/ipc'
import {
  parseDeviceScaleFactor,
  parseInputEvent,
  parseMode,
  parseRect,
  parseScrollReport,
  parseSettings,
  parseUiState,
} from '../shared/ipcPayloads'
import { loadSettings, saveSettings } from '../shared/settings'
import type { HostInfo, ScrollReport, ScrollRequest, UpdateState } from '../shared/types'
import { normalizeUrl } from '../shared/url'
import { isCheckDue, isReleaseUrl } from '../shared/update'
import type { AppContext } from './context'
import { ControlServer } from './controlServer'
import type { TabSession } from './tabSession'
import type { TargetSource } from './targetSource'
import { checkForUpdate } from './updateCheck'

/** Toolbar height reserved at the top of the window; panes sit below it. */
// 82px matches the two `.chrome-row` heights in styles.css (44 + 38, both
// border-box). Main lays the native view out with this until NativeSlot's
// first report takes ownership.
export const TOOLBAR_H = 82

/** Largest design export `readImageFile` will hand to the renderer (encoded bytes). */
export const MAX_IMAGE_FILE_BYTES = 64 * 1024 * 1024

/**
 * How long an agent scroll waits for the target pane to report the offset it
 * reached. A scroll is a synchronous DOM write in the isolated world, so a
 * healthy pane answers within a frame; a second is generous even for a page
 * mid-layout, and short enough that a busy renderer degrades to "could not be
 * confirmed" instead of hanging the control request.
 */
const SCROLL_REPLY_TIMEOUT_MS = 1_000

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
  const { win, bus, tabs } = ctx
  // The active session, resolved at the moment each handler runs. A
  // destructure taken once here is exactly the defect the manager exists to
  // prevent: it captures whichever session booted first and keeps driving it
  // after the user has switched tabs, silently and without erroring.
  const tab = (): TabSession => tabs.active()
  const settingsFile = join(app.getPath('userData'), 'settings.json')
  let settings = loadSettings(settingsFile)
  tabs.maxTabs = settings.maxTabs

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
    // Bound once, and only after the session has settled on its initial
    // `about:blank`: a tab opened and driven in the same breath would
    // otherwise have that late internal commit clear the expectation set here
    // and mirror a stray `about:blank` over the page just requested.
    const s = tab()
    await s.ready
    let wanted = url
    try {
      wanted = normalizeUrl(url)
      s.sync.expect(wanted)
    } catch {
      // Reported by `native.load` / `target.load` below.
    }
    const [applied] = await Promise.all([s.native.load(wanted), s.target.load(wanted)])
    return applied
  }
  ipcMain.handle(IPC.navigate, (e, url: string) => {
    assertRenderer(e)
    return navigateBoth(url)
  })
  // The toolbar's history/reload actions, shared verbatim with the
  // agent-control server's back/forward/reload commands.
  const reloadBoth = (): void => {
    tab().native.reload()
    // A reload commits the URL the target already shows, so the mirror
    // (rightly) does nothing; reload the target on its own.
    tab().target.reload()
  }
  const goBack = (): void => tab().native.back()
  const goForward = (): void => tab().native.forward()
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
    // The resize the pending flag was waiting for has arrived; from here
    // `awaitViewportStable` can watch the viewport itself rather than guess.
    tab().viewportArrived = true
    // Width and height survive any garbage (clampViewport sanitises), but a
    // bad scale factor would decide the offscreen window's raster density —
    // refuse it rather than guess.
    const dsf = parseDeviceScaleFactor(rawDsf)
    if (dsf === null) throw new Error('invalid deviceScaleFactor')
    const v = tab().target.setViewport(width, height, dsf)
    return { width: v.width, height: v.height }
  })
  ipcMain.on(IPC.sendInput, (e, raw: unknown) => {
    if (!fromRenderer(e)) return
    const ev = parseInputEvent(raw)
    if (!ev) return
    try {
      tab().target.sendInput(ev)
    } catch {
      // Electron rejected a well-formed event (e.g. a keyCode it cannot map);
      // the input is lost, the app is not.
    }
  })

  // --- native visibility ----------------------------------------------------
  // Two independent inputs decide whether the native view is on screen: image
  // mode (the left pane is drawn in the renderer instead) and the panes toggle
  // (solo target). Each calling `native.setVisible` directly would clobber the
  // other — leaving image mode would reveal a pane the toggle had hidden — so
  // both write an input here and the visibility is derived in one place.
  // `modeIsLive` is the tab's (image mode belongs to the page under test);
  // `panesShowNative` is the window's (the Both/Target toggle is a window
  // view mode, shared by every tab).
  let panesShowNative = true
  // The manager asks the same question on activation, so the incoming view
  // lands in the right state without re-deriving it there and drifting.
  tabs.nativeVisible = (s: TabSession): boolean => s.modeIsLive && panesShowNative
  const applyNativeVisibility = (): void => {
    const s = tab()
    s.native.setVisible(tabs.nativeVisible(s))
  }

  ipcMain.on(IPC.setMode, (e, raw: unknown) => {
    if (!fromRenderer(e)) return
    const mode = parseMode(raw)
    if (!mode) return
    tab().modeIsLive = mode === 'url'
    applyNativeVisibility()
    // The sync bus follows the *mode* only. In solo target the native pane is
    // still loaded and still the navigation master — disabling the bus there
    // would break the URL bar, back/forward and link clicks in exactly the
    // view where the target pane is the only thing on screen.
    bus.setEnabled(tab().modeIsLive)
  })

  ipcMain.on(IPC.setNativeVisible, (e, raw: unknown) => {
    if (!fromRenderer(e)) return
    if (typeof raw !== 'boolean') return
    panesShowNative = raw
    applyNativeVisibility()
  })

  // --- native pane layout ---------------------------------------------------
  // Main positions the view until the renderer's pane layout exists. The first
  // `setNativeBounds` hands ownership over for the rest of the run, so the two
  // never fight over the same view.
  //
  // Either way the rect goes to the manager, not to one view: the slot is
  // window-global and every session's view is moved to it, so a tab activated
  // later is already positioned before it is shown.
  let rendererDrivesLayout = false
  const fallbackLayout = (): void => {
    if (rendererDrivesLayout) return
    const [w = 0, h = 0] = win.getContentSize()
    tabs.setSlotRect({
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
    tabs.setSlotRect(rect)
    // Ownership passes only once a rect has actually been applied.
    rendererDrivesLayout = true
  })

  // --- scroll round-trip ----------------------------------------------------
  // `applyScroll` carries a correlation id when someone is waiting for the
  // answer. It has to: on an app-shell page (`html, body { overflow: hidden }`
  // with an inner scroller) `window.scrollTo` clamps to 0 without throwing, so
  // "the command was sent" says nothing about whether anything moved. The sync
  // preload writes the offset, reads it back, and replies here.
  //
  // Replies come from the *page* webContents, so the sender check is the
  // inverse of the renderer one above — the same shape SyncBus uses for
  // `syncScroll` — and the payload is parsed like any other renderer message.
  let scrollSeq = 0
  const scrollWaiters = new Map<number, (report: ScrollReport) => void>()
  ipcMain.on(IPC.scrollResult, (e, raw: unknown) => {
    // Routed like `syncScroll`: any tab's panes may answer, because a waiter
    // is keyed by a unique seq and only the tab that was asked holds one.
    // A sender belonging to no session is dropped rather than guessed at.
    if (!tabs.byWebContents(e.sender)) return
    const report = parseScrollReport(raw)
    if (!report) return
    const waiter = scrollWaiters.get(report.id)
    if (!waiter) return
    scrollWaiters.delete(report.id)
    waiter(report)
  })
  /**
   * Drives both panes to an absolute offset and resolves with what the *target*
   * pane reached — the pane every agent capture crops to. The native pane gets
   * the identical apply, unwaited: it is the user's own dev view, and holding
   * the control response on a second round-trip would double the latency of
   * every scroll to report an offset nobody reads.
   *
   * Null means the target could not confirm (destroyed, or too busy to answer
   * within the budget); the caller reports that rather than inventing one.
   */
  const scrollBoth = async (req: ScrollRequest): Promise<ScrollReport | null> => {
    // A preset change reloads the page at a new viewport. Scrolling before
    // that lands finds the pre-reflow document — on an app shell that means
    // the root rather than the inner scroller, and the offset clamps to 0.
    // Bound once, before the first await: everything after it belongs to the
    // tab the scroll was asked of, even if the user switches tabs mid-settle.
    const s = tab()
    await awaitViewportStable(s)
    const base: ScrollRequest = { x: req.x, y: req.y }
    if (req.selector !== undefined) base.selector = req.selector
    if (!s.native.webContents.isDestroyed()) s.native.webContents.send(IPC.applyScroll, base)
    const wc = s.target.webContents
    if (wc.isDestroyed()) return null
    const id = ++scrollSeq
    const answered = new Promise<ScrollReport | null>(resolve => {
      const timer = setTimeout(() => {
        scrollWaiters.delete(id)
        resolve(null)
      }, SCROLL_REPLY_TIMEOUT_MS)
      scrollWaiters.set(id, report => {
        clearTimeout(timer)
        resolve(report)
      })
    })
    wc.send(IPC.applyScroll, { ...base, id })
    return answered
  }

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
    tabs.maxTabs = s.maxTabs
    if (s.agentControl !== wasEnabled) applyAgentControl(s.agentControl)
  })

  // --- agent control --------------------------------------------------------
  // The loopback control server (see `controlServer.ts`). `status` answers
  // from a main-side mirror of the renderer's toolbar state, kept fresh by
  // the renderer's `uiState` reports — main never blocks a request on a
  // renderer round-trip. The mirror starts at the store's initial values and
  // the renderer reports on mount, so it is honest before the first change.
  //
  // `panes` is a window view mode and stays a plain field here; the rest
  // describe the tab, so they read and write through the session and a second
  // tab cannot inherit the first's. The `IPC.uiState` handler updates this
  // with `Object.assign`, which runs the setters — an assignment that replaced
  // the whole object would drop them silently.
  //
  // `mode` mirrors `session.reportedMode`, never `session.modeIsLive`: this
  // object is a report about the renderer, and a report must not write to the
  // control that decides whether the native view is on screen. See TabSession.
  const uiState: AgentUiState = {
    get presetId() {
      return tab().presetId
    },
    set presetId(v: string) {
      tab().presetId = v
    },
    get profileId() {
      return tab().profileId
    },
    set profileId(v: string) {
      tab().profileId = v
    },
    get viewMode() {
      return tab().viewMode
    },
    set viewMode(v: AgentViewMode) {
      tab().viewMode = v
    },
    get mode() {
      return tab().reportedMode
    },
    set mode(v: 'url' | 'image') {
      tab().reportedMode = v
    },
    panes: 'both',
  }
  // The target pane's window-relative bounds (CSS px), for `captureTarget`.
  // Null until the renderer's first measured report; the capture then falls
  // back to the full window with a warning rather than failing.
  let targetBounds: Rect | null = null
  // Where the rendered screen actually sits — the canvas clipped to the pane.
  // `captureTarget` crops to this so the PNG is the screen under test, not the
  // screen plus whatever empty pane surrounds it.
  let canvasBounds: Rect | null = null
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
    const { targetBounds: bounds, canvasBounds: canvas, ...state } = s
    Object.assign(uiState, state)
    targetBounds = bounds ?? null
    canvasBounds = canvas ?? null
    if (!rendererReported) {
      rendererReported = true
      for (const patch of pendingApplies.splice(0)) {
        if (!win.isDestroyed()) win.webContents.send(IPC.agentApply, patch)
      }
    }
  })

  // --- viewport settling -----------------------------------------------------
  // A preset change travels renderer-ward as an apply, comes back as
  // `setViewport`, and only then does the target recreate and reflow. Anything
  // that reads layout in between — a scroll, a capture — must wait for it.
  // Nothing waits when no resize is pending, so an ordinary scroll keeps its
  // millisecond latency.
  /** How long to wait for an announced resize to actually reach setViewport. */
  const VIEWPORT_ARRIVAL_MS = 600

  const awaitViewportStable = async (s: TabSession = tab()): Promise<void> => {
    if (!s.viewportPending) return
    s.viewportPending = false
    const arrivalDeadline = Date.now() + VIEWPORT_ARRIVAL_MS
    while (!s.viewportArrived && Date.now() < arrivalDeadline) {
      await new Promise(r => setTimeout(r, SETTLE_POLL_MS))
    }
    // The preset may resolve to the size already applied, in which case no
    // setViewport ever arrives — the wait above simply expires and the poll
    // below confirms the viewport is steady.
    await settleTarget(s.target)
  }

  // --- capture settling ------------------------------------------------------
  // A preset change recreates the offscreen target at a new viewport and
  // reloads the page. `setPreset` confirms only that the renderer store
  // applied the change, so a capture fired straight after photographs the old
  // texture — the status then disagrees with the image. Wait for the viewport
  // to stop moving and a fresh frame to land before the shutter.
  const SETTLE_POLL_MS = 80
  /** Two identical reads means the resize has stopped. */
  const SETTLE_STABLE_READS = 2
  const SETTLE_BUDGET_MS = 4_000
  /** After the frame reaches the renderer it still has to draw it. */
  const SETTLE_DRAW_MS = 120

  // The target is an argument rather than a fresh `tab().target` at each use:
  // a settle spans awaits, and unsubscribing from whatever is active on the
  // way out would leave a listener on the tab that was actually being watched.
  const nextFrame = (t: TargetSource, budgetMs: number): Promise<boolean> =>
    new Promise(resolve => {
      const timer = setTimeout(() => {
        t.off('frame', onFrame)
        resolve(false)
      }, budgetMs)
      const onFrame = (): void => {
        clearTimeout(timer)
        t.off('frame', onFrame)
        resolve(true)
      }
      t.on('frame', onFrame)
      t.invalidate()
    })

  /** False when the budget ran out before things went quiet; never throws. */
  const settleTarget = async (t: TargetSource = tab().target): Promise<boolean> => {
    const deadline = Date.now() + SETTLE_BUDGET_MS
    let last = ''
    let stable = 0
    while (Date.now() < deadline) {
      const v = t.getViewport()
      const key = `${v.width}x${v.height}`
      stable = key === last ? stable + 1 : 0
      last = key
      if (stable >= SETTLE_STABLE_READS) break
      await new Promise(r => setTimeout(r, SETTLE_POLL_MS))
    }
    if (stable < SETTLE_STABLE_READS) return false
    const painted = await nextFrame(t, Math.max(0, deadline - Date.now()))
    await new Promise(r => setTimeout(r, SETTLE_DRAW_MS))
    return painted
  }

  /** capturePage wants integer CSS pixels; a fractional rect crops short. */
  const roundRect = (r: Rect): Rect => ({
    x: Math.round(r.x),
    y: Math.round(r.y),
    width: Math.max(1, Math.round(r.width)),
    height: Math.max(1, Math.round(r.height)),
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

  // --- update check ---------------------------------------------------------
  // The release URL lives here and only here; `openRelease` takes no argument,
  // so the renderer can never hand the OS a string of its own.
  //
  // Seeded rather than null: Settings shows the running version from the first
  // paint, and `checkedAt: 0` reads as "never" until a check completes.
  let update: UpdateState = { status: 'current', current: appVersion, checkedAt: 0 }
  let releaseUrl = ''

  const runUpdateCheck = async (): Promise<UpdateState> => {
    const now = Date.now()
    const { state, url } = await checkForUpdate(appVersion, now)
    update = state
    releaseUrl = state.status === 'available' && isReleaseUrl(url) ? url : ''
    // Stamped on failures too, so an offline machine retries once a day
    // rather than on every launch.
    const next = { ...settings, lastUpdateCheck: now }
    try {
      saveSettings(settingsFile, next)
      settings = next
    } catch {
      // A read-only settings file must not break the app; the check simply
      // repeats next launch.
    }
    if (!win.isDestroyed()) win.webContents.send(IPC.updateStatus, state)
    return state
  }

  ipcMain.handle(IPC.getUpdate, e => {
    assertRenderer(e)
    return update
  })
  ipcMain.handle(IPC.checkUpdate, e => {
    assertRenderer(e)
    return runUpdateCheck()
  })
  ipcMain.handle(IPC.openRelease, async e => {
    assertRenderer(e)
    if (releaseUrl === '') return false
    await shell.openExternal(releaseUrl)
    return true
  })

  // --- visited-URL history --------------------------------------------------
  // Committed main-frame navigations in the native pane, which is already the
  // navigation master and already emits `did-navigate` for `SyncBus`.
  //
  // Three exclusions come free from that choice of hook, and the third is the
  // one worth spelling out:
  //   * subframe navigations, which `did-navigate` never reports;
  //   * in-page navigations, which arrive on `did-navigate-in-page` — SyncBus
  //     listens to both, this listens to one;
  //   * failed loads. Chromium commits its error page without emitting
  //     `did-navigate` at all: a net-level failure (bad host, refused
  //     connection, missing file, a reload or a Back onto an error page) fires
  //     only `did-fail-load`, which is what feeds the toolbar's error badge.
  //     So the URL bar and the history file agree by construction — anything
  //     that badges is a navigation this listener never hears about. Recording
  //     the requested URL instead, at `navigate` time, would store exactly the
  //     addresses that did not load.
  const historyFile = join(app.getPath('userData'), 'history.json')
  let history = loadHistory(historyFile)

  const publishHistory = (): void => {
    if (!win.isDestroyed()) win.webContents.send(IPC.historyChanged, history)
  }

  // Persist first, then publish: the renderer must never be shown a list disk
  // refused. A read-only userData directory costs the file, not the session.
  const commitHistory = (next: HistoryEntry[]): void => {
    try {
      saveHistory(historyFile, next)
    } catch (e) {
      console.warn('obsrv: could not write history.json', e)
      return
    }
    history = next
    publishHistory()
  }

  // Every tab's native pane, not just the one that booted: history is
  // window-global and a visit is a visit whichever tab made it. The manager
  // wires the hook onto each session it creates.
  tabs.onNativeNavigate = (url: string): void => {
    if (!settings.recordHistory) return
    // `recordVisit` hands back the caller's own array for a URL it will not
    // store — `about:blank` on every launch, most of all — so this is also
    // the guard that keeps the write off the boot path.
    const next = recordVisit(history, url, Date.now())
    if (next === history) return
    commitHistory(next)
  }

  ipcMain.handle(IPC.getHistory, e => {
    assertRenderer(e)
    return history
  })
  ipcMain.handle(IPC.clearHistory, e => {
    assertRenderer(e)
    commitHistory([])
  })

  // Fired after the window exists and never awaited, so a hung network cannot
  // delay the first paint.
  //
  // Under OBSRV_TEST the boot check is skipped unless a stand-in endpoint is
  // given: otherwise every e2e spec would call GitHub on launch, and the
  // settings write that follows would race the specs that assert on settings.
  // `update.spec.ts` sets OBSRV_RELEASES_API and so still exercises this path.
  const bootCheckAllowed = process.env.OBSRV_TEST !== '1' || process.env.OBSRV_RELEASES_API !== undefined
  if (bootCheckAllowed && settings.updateCheck && isCheckDue(settings.lastUpdateCheck, Date.now())) {
    void runUpdateCheck()
  }

  const control = new ControlServer(join(app.getPath('userData'), CONTROL_FILE_NAME), {
    status: () => {
      let url = ''
      try {
        url = tab().target.webContents.getURL()
      } catch {
        // The target is mid-recreation or the app is closing; '' is honest.
      }
      return { version: appVersion, url, ...uiState }
    },
    navigate: navigateBoth,
    apply: patch => {
      if (win.isDestroyed()) return
      // Only a preset resizes the target; view mode and pixel-exact change the
      // magnification, which reflows nothing in the page under test.
      if (patch.presetId !== undefined) {
        tab().viewportPending = true
        tab().viewportArrived = false
      }
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
      await awaitViewportStable()
      await settleTarget()
      const image = await win.webContents.capturePage()
      const size = image.getSize()
      return { data: image.toPNG().toString('base64'), width: size.width, height: size.height }
    },
    captureTarget: async () => {
      await awaitViewportStable()
      const settled = await settleTarget()
      // `capturePage(rect)` crops in the same CSS coordinates the renderer
      // measured, so the reported rect needs no conversion. Crop to the
      // rendered screen, not the pane: a minified mobile preset otherwise
      // comes back as a small phone inside a large empty rectangle.
      const bounds = canvasBounds ?? targetBounds
      const known = bounds !== null && bounds.width >= 1 && bounds.height >= 1
      const image = await win.webContents.capturePage(known ? roundRect(bounds) : undefined)
      const size = image.getSize()
      const warnings: string[] = []
      if (!known) warnings.push('the renderer has not reported the pane bounds yet; captured the full window instead')
      else if (canvasBounds === null) warnings.push('the renderer has not reported the render bounds yet; captured the whole pane instead')
      if (!settled) warnings.push('the target was still resizing when the capture budget ran out; the PNG may show a transitional frame')
      return {
        data: image.toPNG().toString('base64'),
        width: size.width,
        height: size.height,
        warnings,
      }
    },
    viewport: () => tab().target.getViewport(),
    // An agent scroll drives both panes over the same `applyScroll` channel
    // the pane-sync mirror uses — each pane's sync preload applies it and
    // suppresses its own echo, so the two arrive together with no loop.
    // Relying on the mirror instead would be silent: an applied scroll is
    // deliberately not re-reported (see preload/sync.ts).
    scroll: scrollBoth,
    click: c => {
      // Built as the wire shape and passed through parseInputEvent, so a
      // remote click reaches `sendInput` exactly as a canvas-forwarded one.
      const down = parseInputEvent({ type: 'mouseDown', x: c.x, y: c.y, button: c.button, clickCount: 1 })
      const up = parseInputEvent({ type: 'mouseUp', x: c.x, y: c.y, button: c.button, clickCount: 1 })
      if (!down || !up) return
      try {
        tab().target.sendInput(down)
        tab().target.sendInput(up)
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
