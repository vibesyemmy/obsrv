import { WebContentsView, type BrowserWindow, type WebContents } from 'electron'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Rect } from '../shared/api'
import { classifyFileNavigation } from '../shared/fileNav'
import type { LoadError } from '../shared/types'
import { normalizeUrl } from '../shared/url'

export interface NativePaneEvents {
  onLoadError(err: LoadError): void
  /** A PNG/JPEG was dropped on the pane; it was not navigated to. */
  onImageDrop(path: string): void
}

/** net::ERR_ABORTED — fired for ordinary navigation cancellation, not a failure. */
const ERR_ABORTED = -3

/** Loads and commits kept for reading an absence afterwards; the bound `TargetSource.commitTrace` uses. */
const NATIVE_TRACE_MAX = 64

/**
 * One `load()` and what became of it. The outcome is the fact this pane used
 * to destroy: `load` swallows Chromium's rejection so callers need no
 * try/catch, and an aborted navigation and a completed one then look identical
 * from outside (`bug-sync138-no-url-changed` could not tell "the step-2 load
 * never committed" from "it committed after the traces were read", and this is
 * why).
 */
export interface NativeLoadRecord {
  at: number
  url: string
  /** `aborted` is net::ERR_ABORTED: a navigation replaced by another, not a failure. */
  outcome: 'ok' | 'aborted' | 'failed'
  /** Chromium's message, for a failure that is neither of the first two. */
  error?: string
  /** Milliseconds from the call to its outcome. */
  tookMs: number
}

/** One main-frame commit in this pane, with the clock the mirror trace uses. */
export interface NativeCommitRecord {
  at: number
  url: string
  kind: 'did-navigate' | 'in-page'
}

/**
 * The left pane: a real Chromium view at the host device scale factor.
 * URL reporting and navigation mirroring belong to `SyncBus`, which subscribes
 * to this view's `webContents` directly.
 */
export class NativePane {
  readonly view: WebContentsView
  private bounds: Rect = { x: 0, y: 0, width: 0, height: 0 }
  private visible = true
  private readonly loads: NativeLoadRecord[] = []
  private readonly commits: NativeCommitRecord[] = []

  constructor(win: BrowserWindow, private readonly events: NativePaneEvents) {
    this.view = new WebContentsView({
      webPreferences: {
        preload: join(__dirname, '../preload/sync.js'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    })
    this.view.setBackgroundColor('#ffffff')
    win.contentView.addChildView(this.view)
    this.view.setBounds(this.bounds)

    const wc = this.view.webContents
    // This pane's own commits, on the same clock as the mirror trace. The bus
    // subscribes to these too, and a spec comparing the two traces can see a
    // commit the bus never acted on — which is the shape this exists to read.
    wc.on('did-navigate', (_e, url) => this.record(this.commits, { at: Date.now(), url, kind: 'did-navigate' }))
    wc.on('did-navigate-in-page', (_e, url, isMainFrame) => {
      if (isMainFrame) this.record(this.commits, { at: Date.now(), url, kind: 'in-page' })
    })
    wc.on('did-fail-load', (_e, code, description, url, isMainFrame) => {
      if (isMainFrame && code !== ERR_ABORTED) this.events.onLoadError({ code, description, url })
    })
    // An OS file drop navigates the view to `file:///…` and SyncBus would
    // mirror it. A design export is rerouted to image mode; other local files
    // are refused unless the page already is one (see classifyFileNavigation).
    wc.on('will-navigate', (e, url) => {
      const verdict = classifyFileNavigation(wc.getURL(), url)
      if (verdict === 'allow') return
      e.preventDefault()
      if (verdict === 'image') this.events.onImageDrop(fileURLToPath(url))
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
    const startedAt = Date.now()
    try {
      const url = normalizeUrl(input)
      try {
        await this.view.webContents.loadURL(url)
        this.record(this.loads, { at: startedAt, url, outcome: 'ok', tookMs: Date.now() - startedAt })
      } catch (e) {
        // Chromium renders its own error page and `did-fail-load` already
        // reported the code; swallow so callers are not forced into try/catch.
        //
        // Swallowed, but no longer discarded: an aborted load and a completed
        // one used to be the same event from outside this method, and telling
        // them apart is the only remaining question on
        // `bug-sync138-no-url-changed`. The message is Chromium's own, so
        // ERR_ABORTED — a navigation replaced by a later one — is named as
        // what it is rather than as a failure.
        const description = e instanceof Error ? e.message : String(e)
        const aborted = description.includes('ERR_ABORTED')
        this.record(this.loads, {
          at: startedAt,
          url,
          outcome: aborted ? 'aborted' : 'failed',
          ...(aborted ? {} : { error: description }),
          tookMs: Date.now() - startedAt,
        })
      }
      return url
    } catch (e) {
      // Invalid input (e.g. empty) never reaches Chromium, so `did-fail-load`
      // never fires; report it through the same LoadError path instead of
      // rejecting, so callers still never need try/catch. `code: 0` marks
      // this as an input failure rather than a Chromium net:: error code.
      const description = e instanceof Error ? e.message : String(e)
      this.record(this.loads, { at: startedAt, url: input, outcome: 'failed', error: description, tookMs: Date.now() - startedAt })
      this.events.onLoadError({ code: 0, description, url: input })
      return input
    }
  }

  /** Bounded, like the traces it is read beside: the last few are what a failure needs. */
  private record<T>(into: T[], entry: T): void {
    into.push(entry)
    if (into.length > NATIVE_TRACE_MAX) into.splice(0, into.length - NATIVE_TRACE_MAX)
  }

  /**
   * What `load()` did, outcome included — the fact this pane used to swallow.
   * Read beside `SyncBus.mirrorTrace()` and `TargetSource.commitTrace()`: an
   * absence in those is explained by an `aborted` here, and contradicted by an
   * `ok` whose commit arrived after they were read.
   */
  loadTrace(): NativeLoadRecord[] {
    return [...this.loads]
  }

  /** This pane's own main-frame commits, for the same reading. */
  commitTrace(): NativeCommitRecord[] {
    return [...this.commits]
  }

  setBounds(rect: Rect): void {
    this.bounds = rect
    this.view.setBounds(rect)
  }

  getBounds(): Rect {
    return this.bounds
  }

  /** Image mode draws the left pane in the renderer, so the OS-level view hides. */
  setVisible(visible: boolean): void {
    this.visible = visible
    this.view.setVisible(visible)
  }

  isVisible(): boolean {
    return this.visible
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
