import { Menu, shell, type MenuItemConstructorOptions, type WebContents } from 'electron'
import { IPC } from '../shared/ipc'
import type { AppContext } from './context'

/**
 * Standard macOS menus plus File → Open Image…, which only nudges the
 * renderer: it owns the `<input type="file">`, so drag-drop and the menu share
 * one decode path and no file bytes cross IPC.
 *
 * There is deliberately no `{ role: 'viewMenu' }`. That role's Reload / Force
 * Reload and zoom items act on the focused `BrowserWindow`, which is the Obsrv
 * shell itself — reloading it tears down the React tree, the frame
 * subscription and the native-pane layout. The View menu below defines its
 * accelerators explicitly: Cmd+R reloads the two panes (the same calls the
 * `IPC.reload` handler makes for the toolbar button), Cmd+L asks the renderer
 * to focus its URL bar, and DevTools sit behind a non-role item.
 *
 * The tab shortcuts are here for that same reason, not in a renderer
 * `keydown` listener: the native pane is an OS-level `WebContentsView` outside
 * the renderer's document, so a listener there is dead exactly when the user
 * is looking at the page under test. A menu accelerator is resolved by the OS
 * before any renderer sees the key, whichever view holds focus.
 *
 * They drive the manager directly rather than asking the renderer to ask main
 * back: `TabManager` publishes the strip itself on every change, so the
 * renderer follows with no round trip — the same path `IPC.addTab` takes.
 */
export function installMenu({ win, tabs, logFile }: AppContext): void {
  const send = (channel: string): void => {
    if (!win.isDestroyed()) win.webContents.send(channel)
  }
  /**
   * Deferred out of whatever is on the stack, and refused while an open is
   * still in flight. Closing a detached inspector synchronously from inside
   * a Node-inspector dispatch (an `app.evaluate` in the e2e harness, or any
   * future remote driver) in the beat after its frontend has loaded trips a
   * CHECK in Chromium's DevTools teardown and takes the main process down
   * with SIGTRAP — measured 3 of 3, against 0 of 3 for the same close from a
   * timer, or 300 ms later. A menu click from the UI never sits on that
   * stack, so a human never saw it; a tick of deferral costs them nothing.
   * The in-flight guard is the other half: a second toggle before
   * `devtools-opened` used to re-open rather than close, since
   * `isDevToolsOpened()` answers for the request, not the window.
   */
  const devToolsOpening = new WeakSet<WebContents>()
  const toggleDetachedDevTools = (wc: WebContents): void => {
    if (wc.isDestroyed() || devToolsOpening.has(wc)) return
    setTimeout(() => {
      if (wc.isDestroyed() || devToolsOpening.has(wc)) return
      if (wc.isDevToolsOpened()) {
        wc.closeDevTools()
        return
      }
      devToolsOpening.add(wc)
      const settle = (): void => {
        devToolsOpening.delete(wc)
      }
      wc.once('devtools-opened', settle)
      wc.once('devtools-closed', settle)
      wc.openDevTools({ mode: 'detach' })
    }, 0)
  }
  /** Add *and* activate: "new tab" means the tab you asked for is in front. */
  const openTab = (): void => {
    // Null at the cap. Nothing to report from a menu — the strip's own
    // new-tab button carries the explanation and the pointer at Settings.
    const session = tabs.add()
    if (session) tabs.activate(session.id)
  }
  /**
   * Closing the last tab opens a fresh blank one rather than closing the
   * window — the manager's own rule, so Cmd+W and the strip's × agree. Which
   * is why Cmd+W is not `role: 'close'`: that would take the window down with
   * every session in it, and the window is the app.
   */
  const closeTab = (): void => tabs.close(tabs.activeId)
  /** `index` counts from zero; -1 is the last tab, which is what Cmd+9 means. */
  const selectTab = (index: number): void => {
    const list = tabs.tabs
    // A number past the end of a short strip is a no-op, not the nearest tab:
    // the user named a tab that is not there, and moving to a different one
    // would be a guess.
    const wanted = index < 0 ? list[list.length - 1] : list[index]
    if (wanted) tabs.activate(wanted.id)
  }
  // Always enabled, like every browser's: the alternative is rebuilding the
  // application menu on every tab change, which costs a native menu rebuild
  // per keystroke in the URL bar's neighbouring tab and buys a grey label.
  const selectItems: MenuItemConstructorOptions[] = [
    ...[1, 2, 3, 4, 5, 6, 7, 8].map(n => ({
      id: `select-tab-${n}`,
      label: `Select Tab ${n}`,
      accelerator: `CmdOrCtrl+${n}`,
      click: () => selectTab(n - 1),
    })),
    {
      id: 'select-tab-last',
      label: 'Select Last Tab',
      accelerator: 'CmdOrCtrl+9',
      click: () => selectTab(-1),
    },
  ]
  const template: MenuItemConstructorOptions[] = [
    { role: 'appMenu' },
    {
      label: 'File',
      submenu: [
        { id: 'new-tab', label: 'New Tab', accelerator: 'CmdOrCtrl+T', click: openTab },
        { id: 'close-tab', label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: closeTab },
        { type: 'separator' },
        {
          label: 'Open Image…',
          accelerator: 'CmdOrCtrl+O',
          click: () => send(IPC.openImage),
        },
        { type: 'separator' },
        // Displaced to Shift+Cmd+W, as in every browser, because Cmd+W now
        // belongs to the tab. The role keeps the platform behaviour.
        { role: 'close', accelerator: 'Shift+CmdOrCtrl+W' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        {
          label: 'Reload',
          accelerator: 'CmdOrCtrl+R',
          click: () => {
            // Resolved per click, never destructured at install time: a
            // destructure captures whichever session booted first and keeps
            // reloading it after the user has switched tabs.
            const { native, target } = tabs.active()
            native.reload()
            // A reload commits the URL the target already shows, so the mirror
            // (rightly) does nothing; reload the target on its own.
            target.reload()
          },
        },
        {
          label: 'Open Location',
          accelerator: 'CmdOrCtrl+L',
          click: () => send(IPC.focusUrl),
        },
        { type: 'separator' },
        // Three inspectors for three documents. The native pane and the
        // target are pages the user is testing; theirs open detached, since
        // neither has a window of its own to dock into (the target has no
        // visible window at all). The last is Obsrv's own shell.
        {
          id: 'page-devtools',
          label: 'Toggle Page Developer Tools',
          accelerator: 'Shift+CmdOrCtrl+I',
          click: () => toggleDetachedDevTools(tabs.active().native.webContents),
        },
        {
          id: 'target-devtools',
          label: 'Toggle Target Developer Tools',
          accelerator: 'Shift+Alt+CmdOrCtrl+I',
          click: () => toggleDetachedDevTools(tabs.active().target.webContents),
        },
        {
          label: 'Toggle Obsrv Developer Tools',
          accelerator: 'Alt+CmdOrCtrl+I',
          click: () => {
            if (!win.isDestroyed()) win.webContents.toggleDevTools()
          },
        },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    // Chrome's Tab menu, with Chrome's items: the numbers are discoverable
    // here rather than being folklore, and the labels say which is which.
    { label: 'Tab', submenu: selectItems },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        // The evidence a bug report needs. The file is the one place main
        // writes what the renderer cannot see: GPU and renderer processes
        // dying, WebGL contexts lost and recovered, the window going hidden
        // and coming back.
        { id: 'show-log', label: 'Show Log File', click: () => shell.showItemInFolder(logFile) },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
