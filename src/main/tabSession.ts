import type { BrowserWindow, IpcMainEvent } from 'electron'
import { parseScrollPos } from '../shared/ipcPayloads'
import { DEFAULT_ONION_SKIN, REFERENCE_DSF, referenceFits } from '../shared/onionSkin'
import { MAX_VIEWPORT } from '../shared/presets'
import { DEFAULT_THROTTLE } from '../shared/throttle'
import { DEFAULT_TEXT_SCALE } from '../shared/textScale'
import type { VisionType } from '../shared/vision'
import type { AgentViewMode } from '../shared/control'
import { IPC } from '../shared/ipc'
import { DEFAULT_ORIENTATION } from '../shared/presets'
import type { Orientation } from '../shared/types'
import { NativePane } from './nativePane'
import { attachSyncBus, type SyncBus } from './syncBus'
import { TargetSource } from './targetSource'

let nextId = 1

/**
 * One tab: a native `WebContentsView`, an offscreen `TargetSource`, the
 * `SyncBus` mirroring between them, and the state that belongs to that pair
 * rather than to the window.
 *
 * State lives here rather than in `registerIpc`'s closure because closure
 * state plus several sessions fails without erroring — a value silently
 * serves whichever session wrote it last, and the symptom surfaces somewhere
 * unrelated. See the spec's sequencing section.
 */
export class TabSession {
  readonly id: string
  readonly native: NativePane
  readonly target: TargetSource
  readonly sync: SyncBus
  /**
   * The onion skin's other half (shared/onionSkin.ts): the same page at
   * `REFERENCE_DSF` and the target's CSS viewport, kept only while the skin
   * is on. It follows the target — URL, viewport, phone-ness, text scale,
   * scroll — and is otherwise a second offscreen surface like the first.
   */
  reference: TargetSource | null = null
  /** Mirrored from the renderer like the throttle, for `status`; never persisted. */
  onionSkin = DEFAULT_ONION_SKIN

  // `modeIsLive` and `reportedMode` describe the same idea from opposite
  // directions and must not be collapsed into one field. `modeIsLive` is
  // main's own authority over an OS-level view: `IPC.setMode` is the command
  // that writes it and `applyNativeVisibility` is the only thing that reads
  // it. `reportedMode` is a mirror of what the renderer says it is showing,
  // written by the renderer's `IPC.uiState` report so the control server's
  // `status` can answer without a round trip.
  //
  // Letting the report drive visibility would let an observation write to a
  // control, and it reorders badly: a `uiState` arriving ahead of its matching
  // `setMode` would make the next `setNativeVisible` apply the new mode early.
  // Tab activation will start moving these messages around, so keep them apart.

  /** False in image mode: the left pane is drawn in the renderer instead. */
  modeIsLive = true
  /** The renderer's last reported mode, for `status`. Never drives the view. */
  reportedMode: 'url' | 'image' = 'url'
  /**
   * What the strip shows for this tab. Both are main's, because main is what
   * every tab's panes report to: a background tab has no other way to keep its
   * own strip entry current, and the renderer holds one URL bar for the tab in
   * front. `title` is Chromium's page title, empty until the page has one —
   * `tabTitle` falls back to the host, then the URL.
   */
  url = ''
  title = ''

  /** A preset change is in flight; a capture or scroll must wait for it. */
  viewportPending = false
  viewportArrived = false

  presetId = '1080p-24'
  profileId = 'reference'
  /** Mirrored from the renderer like the preset; restored from disk before any renderer reports. */
  textScale = DEFAULT_TEXT_SCALE
  /** Mirrored from the renderer like the text scale; never persisted, every launch starts unthrottled. */
  throttle = DEFAULT_THROTTLE
  /**
   * Which way round this tab's screen is held. Per tab like the preset it
   * rotates, and mirrored here from the renderer's `uiState` for the same
   * reason: a restored tab has to come back the way it was left, and no
   * renderer existed to report that when the list came off disk.
   */
  orientation: Orientation = DEFAULT_ORIENTATION
  /** The viewer simulation the renderer reports, mirrored per tab like the rest. */
  visionType: VisionType = 'none'
  visionSeverity = 1
  viewMode: AgentViewMode = 'fit'

  /**
   * Resolves once both panes have settled on their initial `about:blank`.
   *
   * `TargetSource` owns its first navigation, so the pair does not exist in a
   * usable state the instant the constructor returns: a `navigate` issued
   * before that internal commit lands is undone by it, because the commit
   * clears the expectation the navigate had just set and `SyncBus` rightly
   * mirrors a stray `about:blank` into the other pane. With one session that
   * only ever happened at boot, which is why `boot()` announced the pair by
   * hand; with tabs it happens every time one is opened and driven, so the
   * announcement and the settle belong to the session itself.
   */
  readonly ready: Promise<void>

  constructor(win: BrowserWindow, onUrlChanged: (url: string) => void) {
    this.id = `tab-${nextId++}`
    // `NativePane` takes its callbacks at construction, so these forwards live
    // here rather than in `registerIpc`. Each is guarded: a pane can still
    // report a navigation or an error while the main window is closing.
    this.native = new NativePane(win, {
      onLoadError: err => {
        // Named, like every renderer-bound forward: the renderer keeps a load
        // error per tab, and an unnamed one from a background tab would badge
        // the tab in front.
        if (!win.isDestroyed()) win.webContents.send(IPC.loadError, { tabId: this.id, error: err })
      },
      // The renderer reads the file back over `readImageFile`; no bytes here.
      onImageDrop: path => {
        if (!win.isDestroyed()) win.webContents.send(IPC.openImagePath, path)
      },
    })
    this.target = new TargetSource()
    // SyncBus owns URL reporting for both panes, so the URL bar sees exactly
    // one update per navigation whichever pane started it.
    this.sync = attachSyncBus(this.native, this.target, onUrlChanged)

    // Both panes are being pointed at the same place on purpose, so announce
    // it: otherwise whichever commits first mirrors a pointless `about:blank`
    // into the other. The target is already loading its own, so only the
    // native pane is driven here.
    this.sync.expect('about:blank')
    this.ready = Promise.all([this.native.load('about:blank'), this.target.ready]).then(() => undefined)

    // The reference follows every new document the target commits; an
    // in-place rewrite is the page's own and the reference's page does the
    // same to itself.
    this.target.on('url-changed', (url, inPage) => {
      if (!inPage && this.reference) void this.reference.load(url)
    })
  }

  /**
   * Keeps a HiDPI render of the target's page for the onion skin, or drops
   * it. False when none fits the device-pixel budget at this viewport —
   * the skin is refused, not rendered at a clamped, mismatched size.
   */
  setReference(on: boolean): boolean {
    if (!on) {
      this.reference?.destroy()
      this.reference = null
      return true
    }
    const vp = this.target.getViewport()
    if (!referenceFits(vp.width, vp.height, MAX_VIEWPORT)) {
      this.setReference(false)
      return false
    }
    if (!this.reference) {
      const ref = new TargetSource()
      this.reference = ref
      ref.setPainting(this.target.painting)
      this.syncReference()
      // Its own first navigation must land before it can be driven (see
      // `TargetSource.ready`); the page it then loads is whatever the target
      // shows by then.
      void ref.ready.then(() => {
        if (this.reference === ref) void ref.load(this.target.webContents.getURL())
      })
    }
    return true
  }

  /**
   * The reference takes the target's viewport, phone-ness and text scale.
   * Called after each change of those; a viewport the reference can no
   * longer fit drops it, and the renderer's skin then draws nothing over
   * the target until the viewport fits again and the skin is set anew.
   */
  syncReference(): void {
    const ref = this.reference
    if (!ref) return
    const vp = this.target.getViewport()
    if (!referenceFits(vp.width, vp.height, MAX_VIEWPORT)) {
      this.setReference(false)
      return
    }
    ref.setViewport(vp.width, vp.height, REFERENCE_DSF, this.target.isMobile())
    ref.setTextScale(this.target.getTextScale())
  }

  /**
   * A pane's scroll, as `SyncBus.onScroll` mirrors it to the other pane,
   * applied to the reference too so the ghost stays over the same content.
   * The reference's own preload also reports scrolls; those are nobody's
   * to mirror and the manager's router never resolves them to a session.
   */
  forwardScroll(e: IpcMainEvent, raw: unknown): void {
    const ref = this.reference
    if (!ref || ref.webContents.isDestroyed()) return
    if (e.sender !== this.native.webContents && e.sender !== this.target.webContents) return
    const pos = parseScrollPos(raw)
    if (pos) ref.webContents.send(IPC.applyScroll, pos)
  }

  /**
   * Background tabs stay loaded but stop rasterising. Offscreen rendering runs
   * at a fixed frame rate with `backgroundThrottling: false`, so without this
   * every hidden tab would paint a full viewport forever for nobody. The page
   * keeps its DOM, timers, network and scroll — only pixel production stops.
   *
   * Only the target is suspended. The native pane is an OS-level view that the
   * window has already hidden, and it is Chromium's own compositor deciding
   * whether an occluded view costs anything — main has no `stopPainting` for
   * it and does not need one.
   *
   * The wish is kept by `TargetSource`, not here: a dsf change recreates the
   * offscreen window, and a flag held at this level would go stale the moment
   * a backgrounded tab changed preset.
   */
  setPainting(painting: boolean): void {
    this.target.setPainting(painting)
    this.reference?.setPainting(painting)
  }

  /** Whether this session is producing pixels. */
  get painting(): boolean {
    return this.target.painting
  }

  destroy(): void {
    this.sync.detach()
    this.reference?.destroy()
    this.reference = null
    this.target.destroy()
    this.native.view.webContents.close()
  }
}
