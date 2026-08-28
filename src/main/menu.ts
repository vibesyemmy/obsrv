import { Menu, type MenuItemConstructorOptions } from 'electron'
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
 */
export function installMenu({ win, session }: AppContext): void {
  const { native, target } = session
  const send = (channel: string): void => {
    if (!win.isDestroyed()) win.webContents.send(channel)
  }
  const template: MenuItemConstructorOptions[] = [
    { role: 'appMenu' },
    {
      label: 'File',
      submenu: [
        {
          label: 'Open Image…',
          accelerator: 'CmdOrCtrl+O',
          click: () => send(IPC.openImage),
        },
        { type: 'separator' },
        { role: 'close' },
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
        {
          label: 'Toggle Developer Tools',
          accelerator: 'Alt+CmdOrCtrl+I',
          click: () => {
            if (!win.isDestroyed()) win.webContents.toggleDevTools()
          },
        },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
