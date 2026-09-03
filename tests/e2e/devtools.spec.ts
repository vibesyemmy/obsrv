import { test, expect, type ElectronApplication } from '@playwright/test'
import { launchApp } from './launch'

/**
 * Chromium's own inspector, for the two documents the user is testing. The
 * target has no visible window at all and the native pane has none of its
 * own to dock into, so both open detached; the third item is Obsrv's shell,
 * which docks as before.
 */

let app: ElectronApplication

test.beforeAll(async () => {
  app = await launchApp()
})
test.afterAll(async () => {
  await app.close()
})

const item = (id: string): Promise<{ label: string; enabled: boolean } | null> =>
  app.evaluate(({ Menu }, id: string) => {
    const found = Menu.getApplicationMenu()?.getMenuItemById(id)
    return found ? { label: found.label, enabled: found.enabled } : null
  }, id)

test('the View menu offers inspectors for the page and the target', async () => {
  expect(await item('page-devtools')).toEqual({ label: 'Toggle Page Developer Tools', enabled: true })
  expect(await item('target-devtools')).toEqual({ label: 'Toggle Target Developer Tools', enabled: true })
})

test("the target's opens detached, and the item toggles it closed again", async () => {
  const opened = (): Promise<boolean> =>
    app.evaluate(() => (globalThis as any).__obsrv.target.webContents.isDevToolsOpened())
  expect(await opened()).toBe(false)

  // Armed on the webContents' own `devtools-opened` / `devtools-closed`
  // events, in one evaluate each: `isDevToolsOpened()` goes true the moment
  // the open is requested, before the detached window's frontend has loaded.
  // A resolution on a timer, never a rejection (docs/e2e-flakes.md).
  const toggleAndWait = (event: 'devtools-opened' | 'devtools-closed'): Promise<boolean> =>
    app.evaluate(
      ({ Menu }, ev: string) =>
        new Promise<boolean>(resolve => {
          const wc = (globalThis as any).__obsrv.target.webContents
          const timer = setTimeout(() => resolve(false), 10_000)
          wc.once(ev, () => {
            clearTimeout(timer)
            resolve(true)
          })
          Menu.getApplicationMenu()!.getMenuItemById('target-devtools')!.click()
        }),
      event,
    )

  expect(await toggleAndWait('devtools-opened')).toBe(true)
  expect(await opened()).toBe(true)

  expect(await toggleAndWait('devtools-closed')).toBe(true)
  await expect.poll(opened, { timeout: 10_000 }).toBe(false)
})

test('closing it from inside an inspector dispatch, a beat after it opened, no longer takes the app down', async () => {
  // The sequence that crashed Electron with SIGTRAP three times in three
  // (docs/e2e-flakes.md): a synchronous close issued inside an `app.evaluate`
  // in the beat after `devtools-opened`. The toggle now defers out of the
  // dispatch, so this is the crash sequence run twice with the app still
  // answering afterwards. On a regression the second evaluate finds the
  // app channel closed and the file's remaining assertions fail with it.
  const opened = (): Promise<boolean> =>
    app.evaluate(() => (globalThis as any).__obsrv.target.webContents.isDevToolsOpened())
  for (let round = 0; round < 2; round++) {
    await app.evaluate(
      ({ Menu }) =>
        new Promise<void>(resolve => {
          const wc = (globalThis as any).__obsrv.target.webContents
          const timer = setTimeout(resolve, 10_000)
          wc.once('devtools-opened', () => {
            clearTimeout(timer)
            resolve()
          })
          Menu.getApplicationMenu()!.getMenuItemById('target-devtools')!.click()
        }),
    )
    await app.evaluate(({ Menu }) => {
      Menu.getApplicationMenu()!.getMenuItemById('target-devtools')!.click()
    })
    await expect.poll(opened, { timeout: 10_000 }).toBe(false)
    expect(await app.evaluate(() => 1 + 1)).toBe(2)
  }
})

test('a second toggle before the inspector has opened is ignored, not turned into a re-open', async () => {
  const opened = (): Promise<boolean> =>
    app.evaluate(() => (globalThis as any).__obsrv.target.webContents.isDevToolsOpened())
  await app.evaluate(({ Menu }) => {
    const item = Menu.getApplicationMenu()!.getMenuItemById('target-devtools')!
    item.click()
    item.click()
  })
  await expect.poll(opened, { timeout: 10_000 }).toBe(true)
  await app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('target-devtools')!.click())
  await expect.poll(opened, { timeout: 10_000 }).toBe(false)
})
