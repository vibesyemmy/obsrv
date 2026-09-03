import { BrowserWindow, type WebContents } from 'electron'
import { NO_THROTTLE, type ThrottleProfile } from '../shared/throttle'
import { cursorCss, DEFAULT_CURSOR } from '../shared/cursor'
import { EventEmitter } from 'node:events'
import { join } from 'node:path'
import type { FrameMessage } from '../shared/api'
import { clampViewport, maxCssViewport } from '../shared/calibration'
import { classifyFileNavigation } from '../shared/fileNav'
import { fitsFrame, isFullFrame } from '../shared/paint'
import type { LoadError, TargetInputEvent } from '../shared/types'
import { AUDIT_MAX_TARGETS, AUDIT_MAX_TEXT, AUDIT_SCRIPT, type AuditReport } from '../shared/audit'
import { INSPECT_SCRIPT, INSPECT_WORLD_ID, type InspectReport } from '../shared/inspect'
import { DEFAULT_TEXT_SCALE, isTextScale } from '../shared/textScale'
import { parseAuditReport, parseInspectReport } from '../shared/ipcPayloads'
import { normalizeUrl } from '../shared/url'
import { log } from './log'

/**
 * Frames are emitted in the exact shape they travel over IPC (`FrameMessage`
 * from `shared/api.ts`), so Task 9's `attachFrameBus` is a pass-through and
 * there is no second frame type to keep in sync.
 */
export interface TargetSourceEventMap {
  frame: [FrameMessage]
  /** A committed main-frame navigation; the flag is true for a same-document one (`did-navigate-in-page`). */
  'url-changed': [string, boolean]
  /** The page's cursor as CSS, for the canvas (see shared/cursor.ts). */
  cursor: [string]
  'load-error': [LoadError]
  loading: [boolean]
  /**
   * A main-frame, cross-document navigation started: a paint is now owed.
   * Distinct from `loading`, which also fires for subframe loads — an iframe
   * on a healthy static page changes no pixel and owes no frame, so a stall
   * watchdog keyed to `loading` would cry wolf on it.
   */
  navigating: []
}

export interface AppliedViewport {
  width: number
  height: number
  clamped: boolean
}

/** net::ERR_ABORTED — ordinary navigation cancellation, not a failure. */
const ERR_ABORTED = -3

/** Spec §4.3 rate cap. */
const DEFAULT_FPS = 30

const DEFAULT_VIEWPORT = { width: 1920, height: 1080 }

/**
 * One Android-style mobile Chrome UA for every mobile preset — the phones and
 * the iPad alike. Deliberate simplification: sites key their mobile layouts on
 * "Mobile"/Android vs desktop, and per-preset UA strings would multiply
 * constants without changing what renders. Chrome's version comes from the
 * running Electron so it never drifts from the engine actually rendering.
 */
export const MOBILE_USER_AGENT =
  `Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) ` +
  `Chrome/${process.versions.chrome ?? '120.0.0.0'} Mobile Safari/537.36`

/**
 * `TargetInputEvent` is deliberately Electron-free so the renderer can build
 * one. Its shape matches Electron's input events except that `modifiers` is a
 * plain `string[]` where Electron narrows to a literal union, so the value is
 * cast at this boundary only.
 */
type ElectronInputEvent = Parameters<WebContents['sendInputEvent']>[0]

export interface TargetSourceOptions {
  /**
   * Whether dsf > 1 implies phone fidelity (mobile UA + viewport emulation).
   * The app always wants that coupling; the headless CLI's HiDPI *reference*
   * render (`obsrv diff`) wants a desktop page rasterised dense — desktop UA,
   * desktop viewport semantics, only the raster density changed — so it opts
   * out. Defaults to true, so app behaviour is unchanged.
   */
  mobileEmulation?: boolean
}

/**
 * The right pane's pixel source: an offscreen Chromium window that rasterises
 * at the chosen deviceScaleFactor (1 for monitor presets, the real 2x/3x for
 * mobile ones) whatever the host display does. Its `paint` bitmaps are the
 * true device-pixel raster the whole product exists to show: `frameWidth` and
 * `frameHeight` are always CSS viewport × dsf.
 *
 * `offscreen.deviceScaleFactor` is fixed at window creation, so changing it
 * means recreating the window (`setDeviceScaleFactor`). Order matters: the
 * replacement is created *before* the old window is destroyed — destroying
 * the previous OSR window first was observed (Electron 43 / macOS) to tear
 * the new one down with it, failing its `about:blank` load and leaving a
 * destroyed window. Each fresh window owns a fresh first navigation, so the
 * crash gate below is re-armed per window.
 *
 * Mobile fidelity (dsf > 1) — a documented simplification keyed on the factor
 * alone, because dsf is the only thing the viewport payload carries:
 * - the webContents gets `MOBILE_USER_AGENT` (the native pane keeps its
 *   desktop UA: it is "your dev view");
 * - `enableDeviceEmulation({ screenPosition: 'mobile', … })` supplies mobile
 *   viewport semantics — a page without `<meta name="viewport">` lays out at
 *   Chromium's 980px virtual viewport and is scaled to fit, exactly as phones
 *   do. Chromium wipes the emulation on every cross-document navigation (and
 *   applying it before the first commit segfaults the OSR renderer), so it is
 *   re-applied in `did-navigate`, the earliest post-commit moment. Emulation
 *   never changes paint sizes under OSR — the raster density comes from the
 *   recreated window alone; emulation only shapes layout.
 *
 * **Rotation** needs nothing here. The renderer swaps the CSS axes before it
 * sends them (`applyOrientation`), so the rotated viewport arrives through the
 * ordinary `setViewport` path and `applyEmulation`'s `screenSize`/`viewSize`
 * carry it — which is what makes a page with no `<meta viewport>` lay out
 * correctly in landscape rather than at a portrait virtual viewport.
 *
 * What rotation does *not* reach is JavaScript's idea of the device angle:
 * `screen.orientation.type` and `.angle` keep reporting the host's, and no
 * `orientationchange` fires. `enableDeviceEmulation` has no `screenOrientation`
 * field; raw CDP `Emulation.setDeviceMetricsOverride` does, and it was measured
 * against this class rather than assumed. It is deliberately not used:
 *
 *   - issued before a window's first navigation commits it segfaults the OSR
 *     renderer (SIGSEGV), exactly as `enableDeviceEmulation` does — so it can
 *     only run post-commit, in the same `did-navigate` window as the call
 *     below;
 *   - the two share one override slot, and Electron's call wins: whichever
 *     order they are issued in, `enableDeviceEmulation` resets the angle to 0,
 *     so the very re-apply that keeps mobile layout alive across a navigation
 *     is also what undoes the angle;
 *   - once live, the override pins the page's layout viewport, so a
 *     `setContentSize` no longer reaches the document unless the CDP command is
 *     re-issued with it — a preset change would otherwise leave the page
 *     laying out at the previous screen's size;
 *   - it needs a permanent `webContents.debugger` session on every offscreen
 *     target, and detaching it wipes Electron's own emulation with it.
 *
 * CSS `@media (orientation)`, `screen.width`/`height`, `innerWidth`/`innerHeight`
 * and the raster are all correct from the swap alone. The three JS device-angle
 * readings are the documented gap, in the same spirit as the sync preload's
 * shadow-DOM reach.
 *
 * Every method that touches the window is a no-op once it is destroyed: the
 * renderer's IPC can still arrive after the main window has started closing.
 */
export class TargetSource extends EventEmitter<TargetSourceEventMap> {
  private win!: BrowserWindow
  private viewport = { ...DEFAULT_VIEWPORT }
  private dsf = 1
  /**
   * Whether this screen is a phone or tablet. Told, not inferred: it used to
   * be read off `dsf > 1`, which held only while every laptop and desktop
   * preset was 1x. A Retina laptop is dense *and* a desktop browser, and a
   * Windows panel at 150% is 1.5x and not a phone at all.
   */
  private mobile = false
  /**
   * Browser zoom, as reflow: the page lays out in a CSS viewport `1/scale`
   * the size of the surface and rasters at `scale` times the density, which
   * is what Chromium's own zoom does to a page — except that Chromium's is
   * per host across the session, and would take the native pane and every
   * other tab on the origin with it. Device emulation is this window's alone.
   * See `applyEmulation`; `shared/textScale.ts` has the range.
   */
  private textScale = DEFAULT_TEXT_SCALE
  /** Whether the current window has emulation on, so leaving it can turn it off. */
  private emulating = false
  /** The page's cursor as CSS; a fresh window starts at the arrow. */
  private cursor = DEFAULT_CURSOR
  /**
   * Network conditions and CPU rate for the page, applied through
   * Chromium's debugger the way DevTools applies them (see
   * `shared/throttle.ts`). Held here so a recreated window gets them again.
   */
  private throttle: ThrottleProfile = NO_THROTTLE
  private readonly fps: number
  /** See TargetSourceOptions.mobileEmulation. */
  private readonly mobileEmulation: boolean
  /** Electron's own UA, captured from the first window and restored for dsf 1. */
  private defaultUserAgent: string | null = null
  /**
   * Settles once the current window's first navigation has committed — or can
   * never commit. Chromium's offscreen renderer segfaults (exit 11, Electron
   * 43 / macOS) when a second `loadURL` interrupts the very first one before
   * it commits; interrupting any later navigation is an ordinary
   * `ERR_ABORTED`. Every `load()` waits on this so the unit is safe to drive
   * the instant it is constructed — and re-waits if a recreation swapped in a
   * fresh window (with a fresh first navigation) mid-wait. It also settles if
   * the renderer dies or the surface is destroyed first, so a later `load()`
   * never hangs on a gate that cannot open.
   */
  private firstNavigation!: Promise<void>
  /** True once the current window's first-navigation gate has settled. */
  private firstNavDone = false
  /**
   * The URL the target is meant to be showing: set the moment `load()`
   * accepts a navigation and updated by every committed non-internal
   * main-frame navigation. Recreation restores from *this*, never from the
   * dying window's `getURL()` — mid-recreation that reads the replacement's
   * `about:blank` and a second density change would silently drop the real
   * page; likewise an in-flight `load()` whose window is destroyed under it
   * still gets its URL restored, because it was recorded before the gate.
   */
  private intendedUrl: string | null = null
  /**
   * True while a recreated window loads its internal `about:blank`. Those
   * navigation events are plumbing, not news: reported, SyncBus would mirror
   * `about:blank` into the native pane every time the preset changes density.
   * Frames still flow — a blank paint is stale for a moment, never wrong.
   */
  private internal = false
  private disposed = false
  /**
   * What the owner asked for, not what the current window happens to be doing.
   * See `setPainting` — `recreate()` swaps in a fresh webContents that starts
   * painting, so the wish has to outlive the window that was serving it.
   */
  private paintingWanted = true

  constructor(fps: number = DEFAULT_FPS, options: TargetSourceOptions = {}) {
    super()
    this.fps = fps
    this.mobileEmulation = options.mobileEmulation ?? true
    this.createWindow()
  }

  private createWindow(): void {
    const win = new BrowserWindow({
      show: false,
      width: this.viewport.width,
      height: this.viewport.height,
      useContentSize: true,
      // macOS refuses window sizes larger than the display without this.
      enableLargerThanScreen: true,
      webPreferences: {
        preload: join(__dirname, '../preload/sync.js'),
        // The preload is shared with the native pane and must know which
        // page it is in: only the offscreen one needs its <select>s drawn
        // for it (see shared/selectPopup.ts).
        additionalArguments: ['--obsrv-target'],
        offscreen: { deviceScaleFactor: this.dsf },
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    })
    this.win = win
    this.firstNavDone = false
    this.emulating = false
    this.cursor = DEFAULT_CURSOR

    const wc = win.webContents
    wc.setFrameRate(this.fps)
    // Re-applied per window for the same reason as the frame rate: a fresh
    // webContents starts at Chromium's defaults, and a source that was
    // backgrounded before a dsf change would otherwise come back painting.
    if (!this.paintingWanted) wc.stopPainting()
    wc.setAudioMuted(true)
    // The page's cursor, for the canvas that stands in for this window on
    // screen: Chromium reports every change, and an offscreen window has
    // nothing of its own to show it on.
    wc.on('cursor-changed', (_e, type, image, _scale, _size, hotspot) => {
      const custom =
        type === 'custom' && image && !image.isEmpty() && hotspot ? { dataUrl: image.toDataURL(), hotspot } : undefined
      const css = cursorCss(type, custom)
      if (css === this.cursor) return
      this.cursor = css
      this.emit('cursor', css)
    })
    this.defaultUserAgent ??= wc.getUserAgent()
    // A fresh webContents has a fresh debugger session: the throttle in
    // force is applied to it again. Best effort here — a recreation has no
    // caller to report to; `setThrottle` reports for the explicit path.
    if (this.throttle !== NO_THROTTLE) void this.applyThrottle()
    wc.setUserAgent(this.mobile && this.mobileEmulation ? MOBILE_USER_AGENT : this.defaultUserAgent)

    wc.on('paint', (_event, dirty, image) => {
      if (dirty.width <= 0 || dirty.height <= 0) return
      // Chromium emits one paint with an empty (0x0) image as a navigation
      // commits; it carries no pixels and would advertise a 0x0 frame.
      if (image.isEmpty()) return
      const full = image.getSize()
      // Damage rects are device pixels — except the one `invalidate()` forces,
      // which arrives in DIPs and would otherwise be cropped as a top-left
      // 1/dsf² slice. See shared/paint.ts for the measurements.
      const isFull = isFullFrame(dirty, full.width, full.height, this.dsf)
      // A partial rect that does not fit the bitmap is uninterpretable; a
      // mis-composited slice is worse than a dropped one, and the next paint
      // (or the capture's own invalidate) supplies the pixels anyway.
      if (!isFull && !fitsFrame(dirty, full.width, full.height)) return
      this.emit('frame', {
        frame: {
          x: isFull ? 0 : dirty.x,
          y: isFull ? 0 : dirty.y,
          width: isFull ? full.width : dirty.width,
          height: isFull ? full.height : dirty.height,
          // `toBitmap()` already returns a fresh copy of the pixels (unlike the
          // deprecated `getBitmap()`, typed `void` in Electron 43), and a
          // Buffer is a Uint8Array, so this is the only copy of the slice.
          data: (isFull ? image : image.crop(dirty)).toBitmap(),
        },
        frameWidth: full.width,
        frameHeight: full.height,
      })
    })

    wc.on('did-navigate', (_e, url) => {
      // Chromium wiped any device emulation with the old document; re-apply
      // before reporting, so the page lays out mobile from its first paint.
      this.applyEmulation()
      // The CPU rate is renderer state and a cross-process commit can start
      // running the document before Chromium's own restore of it lands;
      // saying it again here is cheap and closes most of that window.
      if (this.throttle !== NO_THROTTLE) void this.applyThrottle()
      if (this.internal) return
      this.intendedUrl = url
      this.emit('url-changed', url, false)
    })
    wc.on('did-navigate-in-page', (_e, url, isMainFrame) => {
      if (isMainFrame && !this.internal) {
        this.intendedUrl = url
        this.emit('url-changed', url, true)
      }
    })
    wc.on('did-fail-load', (_e, code, description, url, isMainFrame) => {
      // Internal plumbing failures (the recreation `about:blank` of a window
      // that was itself superseded or destroyed) are not the page's news.
      if (isMainFrame && code !== ERR_ABORTED && !this.internal) {
        this.emit('load-error', { code, description, url })
      }
    })
    wc.on('did-start-loading', () => {
      if (!this.internal) this.emit('loading', true)
    })
    wc.on('did-stop-loading', () => {
      if (!this.internal) this.emit('loading', false)
    })
    wc.on('did-start-navigation', details => {
      if (!this.internal && details.isMainFrame && !details.isSameDocument) this.emit('navigating')
    })
    // A dead renderer paints nothing; surface it through the same channel a
    // failed navigation uses so the UI has something to show. A clean exit is
    // our own teardown.
    wc.on('render-process-gone', (_e, details) => {
      if (details.reason === 'clean-exit') return
      log.warn(`target renderer gone (${details.reason}, exit code ${details.exitCode}) at ${wc.getURL()}`)
      this.emit('load-error', {
        code: details.exitCode,
        description: `renderer crashed: ${details.reason}`,
        url: wc.getURL(),
      })
    })
    // Same local-file guard as NativePane, so a page script (or a drop the
    // OS somehow lands here) cannot navigate the target to a file the native
    // pane refused. A dropped export is handled by the native pane alone.
    wc.on('will-navigate', (e, url) => {
      if (classifyFileNavigation(wc.getURL(), url) !== 'allow') e.preventDefault()
    })

    // Keep target-new-window links in the same surface so both panes stay
    // comparable (mirrors NativePane). `window.open()` with no URL (or
    // 'about:blank') must not replace the current page.
    wc.setWindowOpenHandler(({ url }) => {
      if (url && url !== 'about:blank') void this.load(url)
      return { action: 'deny' }
    })

    // Own the first navigation so nothing can interrupt it (see field doc).
    const gate = new Promise<void>(settle => {
      wc.once('render-process-gone', () => settle())
      wc.once('destroyed', () => settle())
      wc.loadURL('about:blank').then(() => settle(), () => settle())
    })
    this.firstNavigation = gate.then(() => {
      if (this.win === win) this.firstNavDone = true
    })
  }

  /**
   * Resolves once this window's own initial `about:blank` has committed.
   * A navigation issued before that lands is undone by it — the commit
   * arrives late and `SyncBus` mirrors it into the native pane — so a caller
   * that builds a source and immediately drives it waits here first. Follows
   * the current window: a dsf change swaps in a fresh one with a fresh gate.
   */
  get ready(): Promise<void> {
    return this.firstNavigation
  }

  /**
   * Mobile viewport semantics for phone screens, and the text scale for any
   * screen (see class doc and `textScale`). Post-commit only: enabling
   * emulation before a window's first navigation commits segfaults the OSR
   * renderer, so callers are either the `did-navigate` handler (by definition
   * post-commit) or gated on `firstNavDone`.
   *
   * The emulated view is the surface divided by the scale, at the surface's
   * density multiplied by it, so the two cancel and the emulated page fills
   * the surface's device pixels exactly — the same arithmetic as the phone
   * case at scale 1, which has always been this call. A desktop screen at
   * scale 1 needs no emulation at all, and turning it off matters: Chromium
   * keeps the last parameters until told otherwise.
   */
  private applyEmulation(): void {
    if (this.win.isDestroyed()) return
    const wc = this.win.webContents
    const mobile = this.mobile && this.mobileEmulation
    const scale = this.textScale
    if (!mobile && scale === 1) {
      if (this.emulating) wc.disableDeviceEmulation()
      this.emulating = false
      return
    }
    // Rounded, not floored: 1366 / 1.5 is 910.67 CSS px, and 911 of them
    // overrun the surface by half a device pixel that is clipped, where 910
    // would leave a device-pixel sliver of nothing down the right edge.
    const size = { width: Math.round(this.viewport.width / scale), height: Math.round(this.viewport.height / scale) }
    wc.enableDeviceEmulation({
      screenPosition: mobile ? 'mobile' : 'desktop',
      screenSize: size,
      viewPosition: { x: 0, y: 0 },
      viewSize: size,
      deviceScaleFactor: this.dsf * scale,
      // The transform that draws the emulated view onto the surface. Without
      // it the view is painted at 1:1 into the top-left corner: the density
      // above is what the page is *told*, not what the compositor rasters at.
      scale,
    })
    this.emulating = true
  }

  /**
   * Sets the text scale (browser zoom as reflow; see the field). Out-of-range
   * values fall to 1 rather than throwing: this is reached from validated
   * payloads and from restore, neither of which has anyone to throw at.
   * Applied at once when the page is up, and by `did-navigate` for every
   * page after — including the fresh window a density change swaps in.
   */
  setTextScale(scale: number): void {
    const next = isTextScale(scale) ? scale : DEFAULT_TEXT_SCALE
    if (next === this.textScale) return
    this.textScale = next
    if (this.disposed || this.win.isDestroyed() || !this.firstNavDone) return
    this.applyEmulation()
    this.win.webContents.invalidate()
  }

  getTextScale(): number {
    return this.textScale
  }

  /** The page's cursor as CSS, as last reported (see `cursor` event). */
  getCursor(): string {
    return this.cursor
  }

  /**
   * Sets the network conditions and CPU rate the page runs under, or lifts
   * them (`NO_THROTTLE`). Resolves with a message when Chromium refused —
   * a debugger already attached by other tooling, say — and null when the
   * conditions are in force. Applied to the current window at once and to
   * every window a density change swaps in.
   */
  async setThrottle(profile: ThrottleProfile): Promise<string | null> {
    this.throttle = profile
    return this.applyThrottle()
  }

  getThrottle(): ThrottleProfile {
    return this.throttle
  }

  private async applyThrottle(): Promise<string | null> {
    if (this.disposed || this.win.isDestroyed()) return null
    const dbg = this.win.webContents.debugger
    const off = this.throttle.network === null && this.throttle.cpuRate === 1
    try {
      // Nothing to lift on a session that was never opened.
      if (off && !dbg.isAttached()) return null
      if (!dbg.isAttached()) dbg.attach('1.3')
      await dbg.sendCommand('Network.enable')
      const n = this.throttle.network
      await dbg.sendCommand(
        'Network.emulateNetworkConditions',
        n
          ? { offline: false, latency: n.latencyMs, downloadThroughput: n.downloadBps, uploadThroughput: n.uploadBps }
          : { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 },
      )
      await dbg.sendCommand('Emulation.setCPUThrottlingRate', { rate: this.throttle.cpuRate })
      // Lifted conditions leave no session behind; the page runs as before.
      if (off) dbg.detach()
      return null
    } catch (e) {
      return `throttle ${this.throttle.id} not applied: ${e instanceof Error ? e.message : String(e)}`
    }
  }

  /**
   * Swaps in a fresh window at the current viewport and dsf, then restores
   * the page the old one was showing. Created before the old is destroyed —
   * see the class doc for why that order is load-bearing.
   */
  private recreate(): void {
    const old = this.win
    this.internal = true
    this.createWindow()
    if (!old.isDestroyed()) old.destroy()
    const win = this.win
    void this.firstNavigation.then(async () => {
      // A newer recreation owns the flags now; leave everything to it.
      if (this.disposed || this.win !== win || win.isDestroyed()) return
      this.internal = false
      // `intendedUrl` is read here, at settle time, not captured when the
      // recreation started: a `load()` issued while the swap was in flight
      // has already recorded its URL and this restore is what applies it
      // (the load's own `loadURL` also fires post-gate; same URL, and
      // whichever loses commits nothing but an ERR_ABORTED).
      const url = this.intendedUrl
      if (url && url !== 'about:blank') {
        try {
          await win.webContents.loadURL(url)
        } catch {
          // `did-fail-load` already reported it; Chromium renders its error page.
        }
      } else {
        win.webContents.invalidate()
      }
    })
  }

  /** Loads URL-bar input; returns the normalised URL that was requested. */
  async load(input: string): Promise<string> {
    try {
      const url = normalizeUrl(input)
      // Recorded before the gate: if a recreation swaps the window while this
      // load waits (or destroys it mid-`loadURL`), the restore still knows
      // what the target was meant to show.
      this.intendedUrl = url
      // The gate is per-window: a dsf change mid-wait swaps in a fresh window
      // with a fresh first navigation, so wait for whichever gate is current.
      let gate: Promise<void>
      do {
        gate = this.firstNavigation
        await gate
      } while (gate !== this.firstNavigation)
      if (this.win.isDestroyed()) return url
      try {
        await this.win.webContents.loadURL(url)
      } catch {
        // `did-fail-load` already reported it; Chromium renders its error page.
      }
      return url
    } catch (e) {
      // Invalid input (e.g. empty) never reaches Chromium, so `did-fail-load`
      // never fires; report it through the same LoadError path instead of
      // rejecting (mirrors NativePane). `code: 0` marks an input failure.
      const description = e instanceof Error ? e.message : String(e)
      this.emit('load-error', { code: 0, description, url: input })
      return input
    }
  }

  /**
   * Resizes the offscreen surface; `width`/`height` are CSS pixels and the
   * clamp budget is device pixels (`maxCssViewport`). A changed
   * `deviceScaleFactor` recreates the window (the offscreen dsf is fixed at
   * creation); a same-dsf resize is the cheap `setContentSize` path. Returns
   * the applied (possibly clamped) CSS size.
   */
  setViewport(width: number, height: number, deviceScaleFactor = 1, mobile = false): AppliedViewport {
    const dsf = Number.isFinite(deviceScaleFactor) && deviceScaleFactor >= 1 ? deviceScaleFactor : 1
    const v = clampViewport(width, height, maxCssViewport(dsf))
    this.viewport = { width: v.width, height: v.height }
    // The user agent is set at window creation, so a change of phone-ness
    // recreates the window exactly as a change of density does.
    const wasMobile = this.mobile
    this.mobile = mobile
    if (dsf !== this.dsf || mobile !== wasMobile) {
      this.dsf = dsf
      if (!this.disposed) this.recreate()
    } else if (!this.win.isDestroyed()) {
      this.win.setContentSize(v.width, v.height)
      // The emulated screen must track the viewport, and Chromium only reads
      // it on (re-)application. Safe here only once the first navigation has
      // committed; before that, the did-navigate re-apply picks up the new
      // size on its own.
      if (this.firstNavDone) this.applyEmulation()
      this.win.webContents.invalidate()
    }
    return v
  }

  /**
   * Changes the raster density alone, keeping the current CSS viewport
   * (re-clamped for the new device-pixel budget). Same recreation path as
   * `setViewport` with a new factor.
   */
  setDeviceScaleFactor(deviceScaleFactor: number): AppliedViewport {
    return this.setViewport(this.viewport.width, this.viewport.height, deviceScaleFactor, this.mobile)
  }

  getViewport(): { width: number; height: number } {
    return { ...this.viewport }
  }

  getDeviceScaleFactor(): number {
    return this.dsf
  }

  /**
   * Stops or resumes rasterisation without touching the page. Offscreen
   * rendering runs at a fixed frame rate with `backgroundThrottling: false`,
   * so a source nobody is looking at would otherwise paint a full viewport
   * forever for nobody. The page keeps its DOM, timers, network and scroll —
   * only pixel production stops.
   */
  setPainting(painting: boolean): void {
    if (this.paintingWanted === painting) return
    this.paintingWanted = painting
    if (this.win.isDestroyed()) return
    const wc = this.win.webContents
    if (wc.isDestroyed()) return
    if (painting) wc.startPainting()
    else wc.stopPainting()
  }

  /** What was last asked of `setPainting`, not what the window is doing. */
  get painting(): boolean {
    return this.paintingWanted
  }

  /** Forces a full-frame repaint, e.g. after the renderer loses its texture. */
  invalidate(): void {
    if (!this.win.isDestroyed()) this.win.webContents.invalidate()
  }

  /**
   * What is under a viewport point, as the page reports it. The script runs
   * in an isolated world of its own — it reads the DOM, and nothing the page
   * defines can shadow what it calls — and its answer is parsed like any
   * other payload from something untrusted. Null before the first
   * navigation, off the page, or when the answer did not parse.
   */
  async inspectAt(x: number, y: number): Promise<InspectReport | null> {
    if (this.win.isDestroyed() || !this.firstNavDone) return null
    const wc = this.win.webContents
    try {
      // The caller speaks surface CSS px (the viewport as set); under a text
      // scale the page's own CSS px are larger by the scale, so the point
      // goes in divided and the box comes back multiplied. Font size stays
      // the page's — it is what the stylesheet says — and the footer scales
      // its millimetres by the same factor.
      const k = this.textScale
      const raw: unknown = await wc.executeJavaScriptInIsolatedWorld(INSPECT_WORLD_ID, [
        { code: `${INSPECT_SCRIPT}('point', ${Number(x) / k}, ${Number(y) / k})` },
      ])
      const report = parseInspectReport(raw)
      if (report === null || k === 1) return report
      const r = report.rect
      return { ...report, rect: { x: r.x * k, y: r.y * k, width: r.width * k, height: r.height * k } }
    } catch {
      // A navigation mid-call, or a page that threw: nothing to report.
      return null
    }
  }

  /**
   * The first match of a CSS selector, reported like `inspectAt` — box in
   * surface CSS px, font size the page's own. Null when nothing matches,
   * the selector is invalid, or the page did not answer.
   */
  async inspectSelector(selector: string): Promise<InspectReport | null> {
    if (this.win.isDestroyed() || !this.firstNavDone) return null
    try {
      const k = this.textScale
      const raw: unknown = await this.win.webContents.executeJavaScriptInIsolatedWorld(INSPECT_WORLD_ID, [
        { code: `${INSPECT_SCRIPT}('selector', ${JSON.stringify(selector)})` },
      ])
      const report = parseInspectReport(raw)
      if (report === null || k === 1) return report
      const r = report.rect
      return { ...report, rect: { x: r.x * k, y: r.y * k, width: r.width * k, height: r.height * k } }
    } catch {
      return null
    }
  }

  /**
   * Every interactive element and every element with text of its own, with
   * boxes and font sizes as the page lays them out — the raw material of the
   * physical-units audit (`cli/audit.ts` decides what is small on a given
   * screen). Same isolated world and the same untrusted-payload parsing as
   * `inspectAt`.
   */
  async auditPage(): Promise<AuditReport | null> {
    if (this.win.isDestroyed() || !this.firstNavDone) return null
    try {
      const raw: unknown = await this.win.webContents.executeJavaScriptInIsolatedWorld(INSPECT_WORLD_ID, [
        { code: `${AUDIT_SCRIPT}(${AUDIT_MAX_TARGETS}, ${AUDIT_MAX_TEXT})` },
      ])
      return parseAuditReport(raw)
    } catch {
      return null
    }
  }

  sendInput(ev: TargetInputEvent): void {
    if (!this.win.isDestroyed()) this.win.webContents.sendInputEvent(ev as unknown as ElectronInputEvent)
  }

  reload(): void {
    if (!this.win.isDestroyed()) this.win.webContents.reload()
  }

  back(): void {
    if (!this.win.isDestroyed()) this.win.webContents.navigationHistory.goBack()
  }

  forward(): void {
    if (!this.win.isDestroyed()) this.win.webContents.navigationHistory.goForward()
  }

  get webContents(): WebContents {
    return this.win.webContents
  }

  destroy(): void {
    this.disposed = true
    this.removeAllListeners()
    if (!this.win.isDestroyed()) this.win.destroy()
  }
}
