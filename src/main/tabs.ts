import { ipcMain, type BrowserWindow, type IpcMainEvent, type WebContents } from 'electron'
import type { Rect } from '../shared/api'
import { IPC } from '../shared/ipc'
import { DEFAULT_SETTINGS } from '../shared/presets'
import { canAddTab, closeTab } from '../shared/tabList'
import { attachFrameBus, type FrameBus } from './frameBus'
import { TabSession } from './tabSession'

/**
 * The list of sessions, which one is in front, and the single `ipcMain`
 * listener for the one channel the page preloads speak on.
 *
 * **The router is the point of this file.** `ipcMain.on` is process-global, so
 * a listener per session receives every session's messages: with two tabs
 * alive, a scroll in a background tab would be applied to the tab in front.
 * Every such channel keeps exactly one listener here, which resolves
 * `e.sender` through `byWebContents` and hands the message to the session that
 * owns that webContents. A sender belonging to no session is dropped, never
 * guessed at — misattributing a message is the failure mode that produces
 * silent cross-tab corruption, and a dropped message is merely a dropped
 * message.
 *
 * The manager also owns the one `FrameBus`, because which target the bus reads
 * is a function of which tab is active: there is one canvas in the renderer, so
 * activation re-points the bus rather than standing a second one up.
 *
 * There is always at least one session. `close` on the last tab opens a fresh
 * one rather than leaving the window with nothing behind it.
 */
export class TabManager {
  private readonly list: TabSession[] = []
  private id = ''
  /**
   * Where the native pane goes, in window coordinates. It is window-global —
   * one slot on screen — and applied to *every* session's view, so activation
   * needs no fresh measurement: the incoming view is already positioned.
   */
  private slot: Rect | null = null

  /** The one bus. Re-pointed by `activate`, never duplicated. */
  readonly bus: FrameBus

  /** The cap from Settings. `registerIpc` owns the settings file and writes it. */
  maxTabs = DEFAULT_SETTINGS.maxTabs

  /**
   * Whether the active session's native view belongs on screen. Two window-
   * level inputs decide it (image mode and the Both/Target toggle) and
   * `registerIpc` derives them in one place, so activation asks rather than
   * re-deriving and drifting.
   */
  nativeVisible: (s: TabSession) => boolean = () => true

  /** A committed main-frame navigation in any tab's native pane, for history. */
  onNativeNavigate: (url: string, s: TabSession) => void = () => {}

  private readonly route = (e: IpcMainEvent, raw: unknown): void => {
    const session = this.byWebContents(e.sender)
    if (!session) return
    session.sync.onScroll(e, raw)
  }

  constructor(private readonly win: BrowserWindow) {
    const first = this.create()
    this.list.push(first)
    this.id = first.id
    // The bus binds its constructor argument as the initial source, so the
    // first session needs no `setSource`; every later activation does.
    this.bus = attachFrameBus(first.target, win)
    ipcMain.on(IPC.syncScroll, this.route)
  }

  get tabs(): readonly TabSession[] {
    return this.list
  }

  get activeId(): string {
    return this.id
  }

  active(): TabSession {
    return this.list.find(t => t.id === this.id) ?? this.list[0]!
  }

  byWebContents(wc: WebContents): TabSession | undefined {
    return this.list.find(t => t.native.webContents === wc || t.target.webContents === wc)
  }

  /** Null at the cap. The new tab is a background tab until `activate`. */
  add(): TabSession | null {
    if (!canAddTab(this.list.length, this.maxTabs)) return null
    const session = this.create()
    this.list.push(session)
    // Born hidden and suspended: `NativePane` starts visible and an offscreen
    // window starts painting, so a tab opened behind the current one would
    // otherwise cover it and rasterise a viewport nobody is reading.
    session.native.setVisible(false)
    session.setPainting(false)
    if (this.slot) session.native.setBounds(this.slot)
    return session
  }

  /**
   * Brings a tab to the front. The ordering here is load-bearing:
   *
   *   * painting resumes on the incoming session *before* `setSource`, because
   *     `setSource`'s invalidate lands on a stopped webContents otherwise and
   *     the canvas keeps showing the outgoing tab's pixels;
   *   * the slot rect is applied before the view is shown, so it never appears
   *     at a stale position first;
   *   * the outgoing session is suspended last, so nothing is dark in between.
   */
  activate(id: string): void {
    const next = this.list.find(t => t.id === id)
    if (!next) return
    const prev = this.list.find(t => t.id === this.id)
    this.id = id
    if (prev && prev !== next) prev.native.setVisible(false)
    next.setPainting(true)
    this.bus.setSource(next.target)
    if (this.slot) next.native.setBounds(this.slot)
    next.native.setVisible(this.nativeVisible(next))
    if (prev && prev !== next) prev.setPainting(false)
  }

  close(id: string): void {
    const going = this.list.find(t => t.id === id)
    if (!going) return
    const result = closeTab([...this.list], id, this.id)
    this.list.length = 0
    this.list.push(...result.tabs)
    // Activate before destroying: the bus is still pointed at the session
    // about to go, and re-pointing it first means it never reads a destroyed
    // source. An empty list gets a fresh tab — the window always has one.
    if (result.activeId === null) {
      const fresh = this.create()
      this.list.push(fresh)
      this.id = fresh.id
      this.bus.setSource(fresh.target)
      if (this.slot) fresh.native.setBounds(this.slot)
      fresh.native.setVisible(this.nativeVisible(fresh))
    } else if (result.activeId !== this.id) {
      this.activate(result.activeId)
    }
    going.destroy()
  }

  /** One slot on screen; every view is moved to it, only the active one shows. */
  setSlotRect(rect: Rect): void {
    this.slot = rect
    for (const t of this.list) t.native.setBounds(rect)
  }

  getSlotRect(): Rect | null {
    return this.slot
  }

  destroy(): void {
    ipcMain.off(IPC.syncScroll, this.route)
    this.bus.detach()
    for (const t of this.list) t.destroy()
    this.list.length = 0
  }

  /**
   * Builds a session and wires its pane events to the window.
   *
   * Every forward is gated on the session being the one in front. The renderer
   * holds one URL bar, one load-error badge and one loading spinner today, so a
   * background tab's late redirect reporting itself would rewrite the front
   * tab's address — the same misattribution the sender router exists to stop,
   * arriving from the other direction. Phase three's per-tab store is what
   * replaces the gate with a tab id.
   */
  private create(): TabSession {
    // `s` is referenced inside its own initialiser: `TabSession` takes the URL
    // forward at construction, and the forward has to know which session it
    // speaks for. The closure only ever runs after the constructor returns, so
    // the binding is always in place by the time it is read.
    const s: TabSession = new TabSession(this.win, url => {
      this.toActive(s, IPC.urlChanged, url)
    })

    s.native.webContents.on('focus', () => {
      // A click on the native pane is invisible to the renderer: the view is an
      // OS-level overlay, so no DOM event reaches the renderer's document and —
      // in an unfocused window — not even a `blur`. Main can see it, so main
      // says so. The renderer's overflow menu uses this to dismiss itself.
      this.toActive(s, IPC.nativeFocused)
    })
    // Ungated: history is window-global, and a visit is a visit whichever tab
    // made it. See `registerIpc`'s history section for why this hook and not
    // `navigate` is the one that records.
    s.native.webContents.on('did-navigate', (_e, url) => this.onNativeNavigate(url, s))

    s.target.on('load-error', err => this.toActive(s, IPC.loadError, err))
    s.target.on('loading', loading => this.toActive(s, IPC.targetLoading, loading))
    s.target.on('navigating', () => this.toActive(s, IPC.targetNavigating))
    return s
  }

  private toActive(s: TabSession, channel: string, ...args: unknown[]): void {
    if (s.id !== this.id) return
    if (this.win.isDestroyed() || this.win.webContents.isDestroyed()) return
    this.win.webContents.send(channel, ...args)
  }
}
