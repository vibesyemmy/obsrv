import type { BrowserWindow } from 'electron'
import type { FrameBus } from './frameBus'
import type { TabSession } from './tabSession'

/** Everything the IPC layer and the test hooks need. Extended as units land. */
export interface AppContext {
  win: BrowserWindow
  /** The one session, until a later unit introduces the manager. */
  session: TabSession
  bus: FrameBus
  /**
   * Main's `TOOLBAR_H`, carried on the context so a test can read the real
   * value instead of restating it. `.chrome` must render exactly this tall or
   * main's cold-start layout puts the native pane in the wrong place.
   */
  toolbarH: number
}
