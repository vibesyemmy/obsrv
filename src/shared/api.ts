import type { AgentApplyPatch, AgentUiReport } from './control'
import type { SelectPopup, SelectResult } from './selectPopup'
import type { PickerEvent, PickerPopup, PickerRequest } from './pickerPopup'
import type { HistoryEntry } from './history'
import type { InspectReport } from './inspect'
import type { TabSnapshot } from './tabList'
import type { FrameSlice, HostInfo, LoadError, Settings, TargetInputEvent, UpdateState } from './types'

export interface FrameMessage {
  frame: FrameSlice
  frameWidth: number
  frameHeight: number
}

/**
 * Every report main pushes about one tab names that tab. The renderer keeps a
 * store per tab and one URL bar; without the id a background tab's late
 * redirect would rewrite the address of the tab in front, and with the old
 * active-only gate a background tab could never refresh its own strip entry.
 */
export interface TabReport {
  tabId: string
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface ObsrvApi {
  navigate(url: string): Promise<string>
  reload(): void
  /**
   * Quits and starts a new process. The target canvas's last resort: once
   * Chromium has given up on the GPU for the session, WebGL is gone until
   * there is a new session, and nothing inside this one can bring it back.
   */
  relaunch(): void
  /**
   * A line for the app log (Help → Show Log File): what the renderer saw
   * that main cannot — a lost WebGL context, and what became of it.
   */
  log(message: string): void
  /**
   * Main pauses the target's rasterisation while the window is hidden,
   * minimised or fully occluded (see `TabManager.setShellVisible`), and says
   * so here. The renderer cannot tell on its own: the shell's page
   * visibility stays `visible` through all three.
   */
  onTargetPaused(cb: (paused: boolean) => void): () => void
  /**
   * The target page's cursor as CSS, for the canvas to wear: an offscreen
   * window has nothing of its own to show it on. Sent for every tab's
   * target; the canvas keeps the one in front.
   */
  onTargetCursor(cb: (m: { tabId: string; cursor: string }) => void): () => void
  /**
   * A `<select>` on the target page asked for its popup, which Chromium
   * cannot show offscreen; the canvas draws it with `openMenu` over the
   * element's box (surface CSS px) and answers with `pickSelect`.
   */
  onSelectPopup(cb: (popup: SelectPopup) => void): () => void
  pickSelect(result: SelectResult): void
  /**
   * A date, time or colour input on the target page asked for its picker,
   * which Chromium cannot open offscreen; the canvas has the overlay host an
   * input of the same type over the element's box with `openPicker`, which
   * resolves once the host is put away. The values flow main → page.
   */
  onPickerPopup(cb: (popup: PickerPopup) => void): () => void
  openPicker(request: PickerRequest): Promise<void>
  /**
   * What is under a point of the target page, in CSS pixels of its
   * viewport: element, font, text colour and the background it sits on.
   * Null off the page, before the first navigation, or when the page's
   * answer did not parse.
   */
  inspect(point: { x: number; y: number }): Promise<InspectReport | null>
  back(): void
  forward(): void
  /**
   * `width`/`height` are CSS pixels; `deviceScaleFactor` (default 1) is the
   * raster density — the target paints `width x height` x the factor.
   */
  /**
   * `mobile` decides phone fidelity (mobile UA and viewport semantics). It is
   * passed rather than derived from `deviceScaleFactor`, because density and
   * being-a-phone are different facts: a Retina laptop is dense and a desktop.
   */
  setViewport(
    width: number,
    height: number,
    deviceScaleFactor?: number,
    mobile?: boolean,
  ): Promise<{ width: number; height: number }>
  /**
   * Browser zoom as reflow, on the target alone: the page lays out in a CSS
   * viewport `1/scale` the size of the screen at `scale` times its density.
   * See `shared/textScale.ts` for the range; main refuses anything outside it.
   */
  setTextScale(scale: number): Promise<void>
  /**
   * Network and CPU conditions on the target (a preset id from
   * `shared/throttle.ts`), the same debugger call the CLI makes. Main
   * refuses an unknown id; a Chromium refusal is logged, not thrown.
   */
  setThrottle(id: string): Promise<void>
  setNativeBounds(rect: Rect): void
  /**
   * Whether the native pane is on screen. It is an OS-level overlay, so
   * unmounting its slot is not enough to hide it. Main combines this with the
   * mode; the renderer never speaks to the view directly.
   */
  setNativeVisible(visible: boolean): void
  /**
   * Take the native view off screen because the chrome is covering it — the
   * settings modal. Separate from `setNativeVisible`, which is the panes
   * toggle: main derives the view's visibility from every input at once, and
   * two callers driving one setter would clobber each other.
   *
   * Menus do not use this. They are drawn in the overlay view, which composites
   * *above* the pane; hiding it for something transient made the render appear
   * to vanish. A modal is the opposite case — it is meant to cover everything.
   */
  setNativeObscured(obscured: boolean): void
  /**
   * Open a menu in the overlay view and resolve with the chosen value, or
   * `null` if it was dismissed. The menu cannot be drawn by the chrome itself:
   * the native pane is composited above the window's DOM, so a dropdown
   * anchored in the toolbar would open underneath it.
   */
  openMenu(request: MenuRequest): Promise<string | null>
  /** Overlay side: the menu to draw. */
  onMenuShow(fn: (request: MenuRequest) => void): () => void
  /** Overlay side: report the outcome and let main put the view away. */
  pickMenu(value: string | null): void
  /** Overlay side: the input to host, or null to take it down. */
  onPickerShow(fn: (request: PickerRequest | null) => void): () => void
  /** Overlay side: the hosted input is in place; main clicks it to open Chromium's picker. */
  pickerReady(): void
  /** Overlay side: the hosted input took a value; `done` when the picker committed. */
  pickerEvent(ev: PickerEvent): void
  /** Overlay side: dismissed without a value. */
  closePicker(): void
  setMode(mode: 'url' | 'image'): void
  sendInput(ev: TargetInputEvent): void
  getHostInfo(): Promise<HostInfo>
  getSettings(): Promise<Settings>
  setSettings(s: Settings): Promise<void>
  onFrame(cb: (m: FrameMessage) => void): () => void
  onUrlChanged(cb: (e: TabReport & { url: string }) => void): () => void
  /**
   * Chromium's page title for one tab — the strip's first choice of label,
   * ahead of the host and the URL. Cleared to `''` on every committed
   * navigation, so a tab never wears the previous page's title.
   */
  onTitleChanged(cb: (e: TabReport & { title: string }) => void): () => void
  onLoadError(cb: (e: TabReport & { error: LoadError }) => void): () => void
  onHostChanged(cb: (h: HostInfo) => void): () => void
  onTargetLoading(cb: (e: TabReport & { loading: boolean }) => void): () => void
  /**
   * The target started a main-frame, cross-document navigation — a paint is
   * owed. `onTargetLoading` also fires for subframe loads, which owe nothing;
   * the stall watchdog keys off this, the toolbar spinner off that.
   */
  onTargetNavigating(cb: (e: TabReport) => void): () => void
  /**
   * The native pane's `WebContentsView` took focus — which is what a click on
   * the live page looks like from the renderer's side, since an OS-level view
   * delivers no DOM event to this document at all. A window `blur` covers the
   * same click while the window holds OS focus; this covers it when it does
   * not, so a popover has a dismissal signal either way.
   */
  onNativeFocused(cb: (e: TabReport) => void): () => void
  /** File → Open Image… in the app menu; the renderer opens its own picker. */
  onOpenImage(cb: () => void): () => void
  /** View → Open Location (Cmd+L) in the app menu; the renderer focuses its URL bar. */
  onFocusUrl(cb: () => void): () => void
  /**
   * A design export was dropped on the native pane. Main refused the
   * navigation and hands the path over; the renderer reads it with
   * `readImageFile` and feeds the same decode path as a drop on itself.
   */
  onOpenImagePath(cb: (path: string) => void): () => void
  /** The bytes of a PNG/JPEG at `path`; rejects on any other extension or an oversized file. */
  readImageFile(path: string): Promise<Uint8Array>
  /**
   * Reports the toolbar's state (plus the target pane's window-relative
   * bounds, once measured) to main, which mirrors it so the agent-control
   * server can answer `status` — and crop `captureTarget` — without a
   * renderer round-trip.
   */
  reportUiState(s: AgentUiReport): void
  /**
   * An agent-control command asks for a preset / profile / view-mode change;
   * the renderer applies it through the same store actions the toolbar uses.
   */
  onAgentApply(cb: (patch: AgentApplyPatch) => void): () => void
  /** An authenticated agent-control command arrived; the toolbar shows its AGENT indicator. */
  onAgentActivity(cb: () => void): () => void
  /** The current update state. Seeded with the running version before any check. */
  getUpdate(): Promise<UpdateState>
  /** Check now, ignoring the daily throttle. Resolves with the new state. */
  checkUpdate(): Promise<UpdateState>
  /**
   * Open the release page. Takes no URL by design: main opens the string it
   * validated itself, so the renderer cannot ask the OS to open anything.
   * Resolves false when there is no stored URL to open.
   */
  openRelease(): Promise<boolean>
  onUpdateStatus(cb: (s: UpdateState) => void): () => void
  /**
   * Every stored address, ranked. The whole list rather than a query: it is
   * capped at 500 small records, and matching is a pure function the renderer
   * can run on a keystroke without an IPC round trip per character.
   */
  getHistory(): Promise<HistoryEntry[]>
  /** Empty the file. Resolves once it has been written. */
  clearHistory(): Promise<void>
  /** A navigation was recorded, or the list was cleared. Carries the new list. */
  onHistoryChanged(cb: (entries: HistoryEntry[]) => void): () => void

  /**
   * The strip as main holds it. Main owns tab identity — a tab is two
   * Chromium renderers it built — so the renderer mirrors this list rather
   * than minting ids of its own, and every command below names a tab from it.
   */
  getTabs(): Promise<TabSnapshot>
  /**
   * Opens a tab and brings it to the front, resolving with its id — or null
   * when `settings.maxTabs` is already reached. The strip refuses first (the
   * button is disabled at the cap); this is the authority behind it.
   */
  addTab(): Promise<string | null>
  /**
   * Closes a tab. Closing the last one opens a fresh blank one rather than
   * emptying the window; an id no tab carries is ignored.
   */
  closeTab(id: string): void
  activateTab(id: string): void
  /** A tab opened, closed, or came to the front. Carries the whole strip. */
  onTabsChanged(cb: (s: TabSnapshot) => void): () => void
}

declare global {
  interface Window {
    obsrv: ObsrvApi
  }
}

/** One option row. `value` is what the caller gets back. */
export interface MenuOption {
  value: string
  label: string
}

/** A titled run of rows; the title is omitted for ungrouped ones. */
export interface MenuGroup {
  label?: string
  options: MenuOption[]
}

export interface MenuRequest {
  groups: MenuGroup[]
  /** The row that carries the tick, and where the keyboard starts. */
  value: string
  ariaLabel: string
  /**
   * The trigger's rectangle in the window's own coordinates. The overlay spans
   * the whole content area, so these need no conversion — and the menu is
   * clamped to that area, which is what keeps it inside the app.
   */
  anchor: { x: number; y: number; width: number; height: number }
}
