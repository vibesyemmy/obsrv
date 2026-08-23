import { BrowserWindow, type WebContents } from 'electron'
import { EventEmitter } from 'node:events'
import { join } from 'node:path'
import type { FrameMessage } from '../shared/api'
import { clampViewport } from '../shared/calibration'
import { classifyFileNavigation } from '../shared/fileNav'
import type { LoadError, TargetInputEvent } from '../shared/types'
import { normalizeUrl } from '../shared/url'

/**
 * Frames are emitted in the exact shape they travel over IPC (`FrameMessage`
 * from `shared/api.ts`), so Task 9's `attachFrameBus` is a pass-through and
 * there is no second frame type to keep in sync.
 */
export interface TargetSourceEventMap {
  frame: [FrameMessage]
  'url-changed': [string]
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
 * `TargetInputEvent` is deliberately Electron-free so the renderer can build
 * one. Its shape matches Electron's input events except that `modifiers` is a
 * plain `string[]` where Electron narrows to a literal union, so the value is
 * cast at this boundary only.
 */
type ElectronInputEvent = Parameters<WebContents['sendInputEvent']>[0]

/**
 * The right pane's pixel source: an offscreen Chromium window that rasterises
 * at deviceScaleFactor 1 whatever the host display does. Its `paint` bitmaps
 * are the true 1x raster the whole product exists to show.
 *
 * `offscreen.deviceScaleFactor` already defaults to 1; it is passed explicitly
 * so the intent survives an Electron upgrade. The first E2E test asserts the
 * frame size equals the CSS viewport, which fails loudly if that ever changes.
 *
 * Every method that touches the window is a no-op once it is destroyed: the
 * renderer's IPC can still arrive after the main window has started closing.
 */
export class TargetSource extends EventEmitter<TargetSourceEventMap> {
  private readonly win: BrowserWindow
  private viewport = { ...DEFAULT_VIEWPORT }
  /**
   * Settles once the surface's first navigation has committed — or can never
   * commit. Chromium's offscreen renderer segfaults (exit 11, Electron 43 /
   * macOS) when a second `loadURL` interrupts the very first one before it
   * commits; interrupting any later navigation is an ordinary `ERR_ABORTED`.
   * Every `load()` waits on this so the unit is safe to drive the instant it
   * is constructed. It also settles if the renderer dies or the surface is
   * destroyed first, so a later `load()` never hangs on a gate that cannot
   * open.
   */
  private readonly firstNavigation: Promise<void>

  constructor(fps: number = DEFAULT_FPS) {
    super()
    this.win = new BrowserWindow({
      show: false,
      width: this.viewport.width,
      height: this.viewport.height,
      useContentSize: true,
      // macOS refuses window sizes larger than the display without this.
      enableLargerThanScreen: true,
      webPreferences: {
        preload: join(__dirname, '../preload/sync.js'),
        offscreen: { deviceScaleFactor: 1 },
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    })

    const wc = this.win.webContents
    wc.setFrameRate(fps)
    wc.setAudioMuted(true)

    wc.on('paint', (_event, dirty, image) => {
      if (dirty.width <= 0 || dirty.height <= 0) return
      // Chromium emits one paint with an empty (0x0) image as a navigation
      // commits; it carries no pixels and would advertise a 0x0 frame.
      if (image.isEmpty()) return
      const full = image.getSize()
      const isFull = dirty.x === 0 && dirty.y === 0 && dirty.width === full.width && dirty.height === full.height
      this.emit('frame', {
        frame: {
          x: dirty.x,
          y: dirty.y,
          width: dirty.width,
          height: dirty.height,
          // `toBitmap()` already returns a fresh copy of the pixels (unlike the
          // deprecated `getBitmap()`, typed `void` in Electron 43), and a
          // Buffer is a Uint8Array, so this is the only copy of the slice.
          data: (isFull ? image : image.crop(dirty)).toBitmap(),
        },
        frameWidth: full.width,
        frameHeight: full.height,
      })
    })

    wc.on('did-navigate', (_e, url) => this.emit('url-changed', url))
    wc.on('did-navigate-in-page', (_e, url, isMainFrame) => {
      if (isMainFrame) this.emit('url-changed', url)
    })
    wc.on('did-fail-load', (_e, code, description, url, isMainFrame) => {
      if (isMainFrame && code !== ERR_ABORTED) this.emit('load-error', { code, description, url })
    })
    wc.on('did-start-loading', () => this.emit('loading', true))
    wc.on('did-stop-loading', () => this.emit('loading', false))
    wc.on('did-start-navigation', details => {
      if (details.isMainFrame && !details.isSameDocument) this.emit('navigating')
    })
    // A dead renderer paints nothing; surface it through the same channel a
    // failed navigation uses so the UI has something to show. A clean exit is
    // our own teardown.
    wc.on('render-process-gone', (_e, details) => {
      if (details.reason === 'clean-exit') return
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
    this.firstNavigation = new Promise<void>(settle => {
      wc.once('render-process-gone', () => settle())
      wc.once('destroyed', () => settle())
      wc.loadURL('about:blank').then(() => settle(), () => settle())
    })
  }

  /** Loads URL-bar input; returns the normalised URL that was requested. */
  async load(input: string): Promise<string> {
    try {
      const url = normalizeUrl(input)
      await this.firstNavigation
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

  /** Resizes the offscreen surface. Returns the applied (possibly clamped) size. */
  setViewport(width: number, height: number): AppliedViewport {
    const v = clampViewport(width, height)
    this.viewport = { width: v.width, height: v.height }
    if (!this.win.isDestroyed()) {
      this.win.setContentSize(v.width, v.height)
      this.win.webContents.invalidate()
    }
    return v
  }

  getViewport(): { width: number; height: number } {
    return { ...this.viewport }
  }

  /** Forces a full-frame repaint, e.g. after the renderer loses its texture. */
  invalidate(): void {
    if (!this.win.isDestroyed()) this.win.webContents.invalidate()
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
    this.removeAllListeners()
    if (!this.win.isDestroyed()) this.win.destroy()
  }
}
