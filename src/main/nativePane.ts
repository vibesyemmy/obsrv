import { WebContentsView, type BrowserWindow, type WebContents } from 'electron'
import type { Rect } from '../shared/api'
import type { LoadError } from '../shared/types'
import { normalizeUrl } from '../shared/url'

export interface NativePaneEvents {
  onUrlChanged(url: string): void
  onLoadError(err: LoadError): void
}

/** net::ERR_ABORTED — fired for ordinary navigation cancellation, not a failure. */
const ERR_ABORTED = -3

/** The left pane: a real Chromium view at the host device scale factor. */
export class NativePane {
  readonly view: WebContentsView
  private bounds: Rect = { x: 0, y: 0, width: 0, height: 0 }

  constructor(win: BrowserWindow, private readonly events: NativePaneEvents) {
    this.view = new WebContentsView({
      webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
    })
    this.view.setBackgroundColor('#ffffff')
    win.contentView.addChildView(this.view)
    this.view.setBounds(this.bounds)

    const wc = this.view.webContents
    wc.on('did-navigate', (_e, url) => this.events.onUrlChanged(url))
    wc.on('did-navigate-in-page', (_e, url, isMainFrame) => {
      if (isMainFrame) this.events.onUrlChanged(url)
    })
    wc.on('did-fail-load', (_e, code, description, url, isMainFrame) => {
      if (isMainFrame && code !== ERR_ABORTED) this.events.onLoadError({ code, description, url })
    })
    // Keep target-new-window links in the same pane so both panes stay comparable.
    // `window.open()` with no URL (or 'about:blank') must not replace the
    // current page — only navigate when a real target URL was requested.
    wc.setWindowOpenHandler(({ url }) => {
      if (url && url !== 'about:blank') void this.load(url)
      return { action: 'deny' }
    })
  }

  /** Loads URL-bar input; returns the normalised URL that was requested. */
  async load(input: string): Promise<string> {
    try {
      const url = normalizeUrl(input)
      try {
        await this.view.webContents.loadURL(url)
      } catch {
        // Chromium renders its own error page and `did-fail-load` already
        // reported the code; swallow so callers are not forced into try/catch.
      }
      return url
    } catch (e) {
      // Invalid input (e.g. empty) never reaches Chromium, so `did-fail-load`
      // never fires; report it through the same LoadError path instead of
      // rejecting, so callers still never need try/catch. `code: 0` marks
      // this as an input failure rather than a Chromium net:: error code.
      const description = e instanceof Error ? e.message : String(e)
      this.events.onLoadError({ code: 0, description, url: input })
      return input
    }
  }

  setBounds(rect: Rect): void {
    this.bounds = rect
    this.view.setBounds(rect)
  }

  getBounds(): Rect {
    return this.bounds
  }

  reload(): void {
    this.view.webContents.reload()
  }

  back(): void {
    this.view.webContents.navigationHistory.goBack()
  }

  forward(): void {
    this.view.webContents.navigationHistory.goForward()
  }

  get webContents(): WebContents {
    return this.view.webContents
  }
}
