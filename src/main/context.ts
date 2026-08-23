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
}
