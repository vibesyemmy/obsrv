import type { BrowserWindow } from 'electron'
import type { FrameBus } from './frameBus'
import type { Overlay } from './overlay'
import type { TabManager } from './tabs'

/** Everything the IPC layer and the test hooks need. Extended as units land. */
export interface AppContext {
  win: BrowserWindow
  /**
   * The sessions and which one is in front. Every consumer reads the active
   * session through `tabs.active()` at the moment it needs it — a destructure
   * taken once captures the session that happened to boot first, and keeps
   * driving it after the user has switched tabs.
   */
  tabs: TabManager
  /** The one bus, owned by the manager because activation re-points it. */
  bus: FrameBus
  /**
   * Main's `TOOLBAR_H`, carried on the context so a test can read the real
   * value instead of restating it. `.chrome` must render exactly this tall or
   * main's cold-start layout puts the native pane in the wrong place.
   */
  toolbarH: number
  /**
   * The transparent view menus are drawn in. It has to be a sibling of the
   * panes rather than markup in the chrome: the native pane is composited above
   * the window's DOM, so a menu rendered there opens underneath it.
   */
  overlay: Overlay
  /** Where main writes its log; Help → Show Log File reveals it. */
  logFile: string
}
