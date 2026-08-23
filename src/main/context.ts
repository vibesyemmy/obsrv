import type { BrowserWindow } from 'electron'
import type { NativePane } from './nativePane'

/** Everything the IPC layer and the test hooks need. Extended as units land. */
export interface AppContext {
  win: BrowserWindow
  native: NativePane
}
