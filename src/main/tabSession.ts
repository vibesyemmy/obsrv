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
