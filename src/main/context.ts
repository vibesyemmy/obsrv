import type { BrowserWindow } from 'electron'
import type { FrameBus } from './frameBus'
import type { NativePane } from './nativePane'
import type { SyncBus } from './syncBus'
import type { TargetSource } from './targetSource'

/** Everything the IPC layer and the test hooks need. Extended as units land. */
export interface AppContext {
  win: BrowserWindow
  native: NativePane
  target: TargetSource
  bus: FrameBus
  sync: SyncBus
  /**
   * Main's `TOOLBAR_H`, carried on the context so a test can read the real
   * value instead of restating it. `.chrome` must render exactly this tall or
   * main's cold-start layout puts the native pane in the wrong place.
   */
  toolbarH: number
}
