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

  await app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('target-devtools')!.click())
  await expect.poll(opened, { timeout: 10_000 }).toBe(true)

  await app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('target-devtools')!.click())
  await expect.poll(opened, { timeout: 10_000 }).toBe(false)
})
