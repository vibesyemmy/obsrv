import type { BrowserWindow } from 'electron'
import type { AgentViewMode } from '../shared/control'
import { IPC } from '../shared/ipc'
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

  /** False in image mode: the left pane is drawn in the renderer instead. */
  modeIsLive = true
  /** A preset change is in flight; a capture or scroll must wait for it. */
  viewportPending = false
  viewportArrived = false

  presetId = '1080p-24'
  profileId = 'reference'
  viewMode: AgentViewMode = 'fit'

  constructor(win: BrowserWindow, onUrlChanged: (url: string) => void) {
    this.id = `tab-${nextId++}`
    // `NativePane` takes its callbacks at construction, so these forwards live
    // here rather than in `registerIpc`. Each is guarded: a pane can still
    // report a navigation or an error while the main window is closing.
    this.native = new NativePane(win, {
      onLoadError: err => {
        if (!win.isDestroyed()) win.webContents.send(IPC.loadError, err)
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
  }

  destroy(): void {
    this.sync.detach()
    this.target.destroy()
    this.native.view.webContents.close()
  }
}
