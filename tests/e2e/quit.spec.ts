import { test, expect, type ElectronApplication } from '@playwright/test'
import { IPC } from '../../src/shared/ipc'
import { launchApp, rendererWindow } from './launch'

/**
 * Quitting is the one thing this file is about, so each test owns its own app
 * and closes it as the assertion rather than in an `afterAll`.
 *
 * `ElectronApplication.close()` is `app.quit()` plus a wait for the process to
 * exit, and it waits forever. Racing it against a clock is what turns a hung
 * app into a failing test instead of a hung suite; the kill is so that a
 * failure leaves no stranded Electron behind.
 */
async function closesWithin(app: ElectronApplication, ms: number): Promise<boolean> {
  let exited = false
  const settle = (): void => {
    exited = true
  }
  await Promise.race([app.close().then(settle, settle), new Promise(r => setTimeout(r, ms))])
  if (!exited) app.process().kill('SIGKILL')
  return exited
}

const QUIT_BUDGET_MS = 15_000

test('the app exits when it is quit after a tab was closed', async () => {
  const app = await launchApp()
  await rendererWindow(app)

  const id = await app.evaluate(async () => {
    const s = (globalThis as any).__obsrv.tabs.add()
    await s.ready
    ;(globalThis as any).__obsrv.tabs.activate(s.id)
    return s.id as string
  })
  // Closing a tab republishes the strip, so the renderer re-reports its state:
  // a `uiState` message is in flight at exactly the moment the quit below
  // tears the tab manager down. That is the shape that used to hang.
  await app.evaluate((_e, tabId: string) => (globalThis as any).__obsrv.tabs.close(tabId), id)

  expect(await closesWithin(app, QUIT_BUDGET_MS)).toBe(true)
})

test('a renderer report that arrives after the window starts closing does not throw in main', async () => {
  const app = await launchApp()
  await rendererWindow(app)

  // The race above, made deterministic. Chromium keeps the window's
  // `webContents` alive for tens of milliseconds past `close`, so a report
  // sent before the window went away can be delivered after `boot()` has run
  // its teardown. Emitting the event by hand runs that teardown while leaving
  // the window (and therefore a valid sender) intact, so the late report can
  // be delivered on purpose instead of hoped for.
  //
  // A throw here is not a caught error somewhere: it is an uncaught exception
  // in main, which Electron answers with a modal dialog, which `app.quit()`
  // can never finish through — the close below would never return.
  const thrown = await app.evaluate(({ ipcMain }, channel: string) => {
    const obsrv = (globalThis as any).__obsrv
    const win = obsrv.win
    const report = {
      tabId: obsrv.tabs.activeId,
      presetId: '1080p-24',
      profileId: 'reference',
      viewMode: 'fit',
      mode: 'url',
      panes: 'both',
    }
    win.emit('close')
    try {
      ipcMain.emit(channel, { sender: win.webContents }, report)
      return null
    } catch (e) {
      return e instanceof Error ? e.message : String(e)
    }
  }, IPC.uiState)

  expect(thrown).toBeNull()
  expect(await closesWithin(app, QUIT_BUDGET_MS)).toBe(true)
})
