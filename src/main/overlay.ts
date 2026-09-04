import { app, WebContentsView, type BrowserWindow } from 'electron'
import { join } from 'node:path'
import { IPC } from '../shared/ipc'
import type { MenuRequest } from '../shared/api'
import type { PickerRequest } from '../shared/pickerPopup'

/**
 * A transparent view spanning the window, for the one kind of UI the renderer
 * cannot draw itself: anything that has to appear over the native pane.
 *
 * The pane is a `WebContentsView`, which the OS composites *above* the window's
 * own DOM — nothing the renderer paints can cover it. A dropdown anchored in
 * the toolbar opens straight across it, so the menu has to be a sibling view
 * stacked higher rather than markup in the main renderer.
 *
 * A child `BrowserWindow` would also composite above, and was rejected: on
 * macOS focusing one dims the parent's title bar, so the app would look
 * inactive every time a menu opened. Views inside the window trade focus
 * between themselves without the window ever losing key status.
 *
 * It loads the same renderer entry with `?overlay=1`, so there is one bundle,
 * one stylesheet and one palette rather than a second front end to keep in
 * step. While no menu is open the view is hidden — a visible transparent view
 * spanning the window would swallow every click meant for the panes.
 */
export class Overlay {
  private readonly view: WebContentsView
  private open = false
  private destroyed = false

  constructor(private readonly win: BrowserWindow) {
    this.view = new WebContentsView({
      webPreferences: {
        preload: join(__dirname, '../preload/app.js'),
        contextIsolation: true,
        sandbox: true,
        // Transparency has to be asked for at construction; setting the
        // background colour afterwards is not enough to keep the page's own
        // white from painting over the panes.
        transparent: true,
      },
    })
    this.view.setBackgroundColor('#00000000')
    this.win.contentView.addChildView(this.view)
    this.view.setVisible(false)
    this.layout()

    if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL)
      void this.view.webContents.loadURL(`${process.env.ELECTRON_RENDERER_URL}?overlay=1`)
    else
      void this.view.webContents.loadFile(join(__dirname, '../renderer/index.html'), {
        query: { overlay: '1' },
      })

    this.win.on('resize', () => this.layout())
  }

  get webContents() {
    return this.view.webContents
  }

  /** Covers the whole content area: the menu positions itself within it, and
   *  the rest of the surface is what catches a click meant to dismiss. */
  private layout(): void {
    const [width = 0, height = 0] = this.win.getContentSize()
    this.view.setBounds({ x: 0, y: 0, width, height })
  }

  show(request: MenuRequest): void {
    // Raised on every open rather than once at construction: a new tab adds its
    // native pane after this view was created, and the last child added is the
    // topmost. Re-adding an existing child moves it to the top.
    this.win.contentView.addChildView(this.view)
    this.layout()
    this.view.setVisible(true)
    this.open = true
    this.view.webContents.focus()
    this.view.webContents.send(IPC.menuShow, request)
  }

  /**
   * The view's other job: host a real input of a picker's type over the
   * target's own, so Chromium's picker — which offscreen never opens —
   * hangs on this one instead (see shared/pickerPopup.ts).
   */
  showPicker(request: PickerRequest): void {
    this.win.contentView.addChildView(this.view)
    this.layout()
    this.view.setVisible(true)
    this.open = true
    this.view.webContents.focus()
    this.view.webContents.send(IPC.pickerShow, request)
  }

  /**
   * A click as a user would make it, at window content coordinates (the
   * view's own, since it spans the content area from its origin). A trusted
   * event is what opens a hosted input's picker: `showPicker()` from the
   * page would need an activation the page never got.
   */
  clickAt(x: number, y: number): void {
    const wc = this.view.webContents
    wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 })
    wc.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 })
  }

  hide(): void {
    if (!this.open) return
    this.open = false
    this.view.setVisible(false)
    // Whatever the view was showing is taken down with it; a hosted input
    // left mounted would keep the page's focus and answer the next click.
    if (!this.view.webContents.isDestroyed()) this.view.webContents.send(IPC.pickerShow, null)
    // Focus goes back to the chrome, or the next keystroke would land nowhere
    // and the trigger could not take its focus ring back.
    this.win.webContents.focus()
  }

  get isOpen(): boolean {
    return this.open
  }

  /**
   * Idempotent, because the window's `close` handler is not guaranteed to run
   * once: quit.spec.ts emits `close` by hand to drive the teardown while the
   * window is still alive, and the real close then runs it again. A throw on
   * the second pass would take the rest of that handler with it — including the
   * destroy of the offscreen windows, without which `window-all-closed` never
   * fires and the app hangs instead of quitting.
   */
  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.win.contentView.removeChildView(this.view)
    if (!this.view.webContents.isDestroyed()) this.view.webContents.close()
  }
}
