import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { launchApp, rendererWindow } from './launch'

// Each test leaves the session painting again, but they share one app and the
// frame collector is global to the renderer, so order still matters.
test.describe.configure({ mode: 'serial' })

let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  app = await launchApp()
  page = await rendererWindow(app)
})
test.afterAll(async () => {
  await app.close()
})

/**
 * Whether the offscreen source is actually rasterising, read from Chromium
 * rather than from our own flag — the point of the test is that the wish
 * reaches the webContents, so asserting on the wish would prove nothing.
 */
const painting = (): Promise<boolean> =>
  app.evaluate(() => (globalThis as any).__obsrv.session.target.webContents.isPainting())

test('a session stops and resumes painting', async () => {
  expect(await painting()).toBe(true)

  await app.evaluate(() => (globalThis as any).__obsrv.session.setPainting(false))
  await expect.poll(painting).toBe(false)

  await app.evaluate(() => (globalThis as any).__obsrv.session.setPainting(true))
  await expect.poll(painting).toBe(true)
})

test('a suspended session stays suspended across a device-scale-factor change', async () => {
  // A dsf change recreates the offscreen window, and a fresh webContents
  // starts painting. A background tab whose preset is changed by an agent (or
  // by the CLI) must not quietly resume producing frames nobody reads.
  await app.evaluate(() => (globalThis as any).__obsrv.session.setPainting(false))
  await expect.poll(painting).toBe(false)

  await app.evaluate(() => (globalThis as any).__obsrv.target.setViewport(390, 844, 2))
  await expect.poll(painting, { timeout: 10_000 }).toBe(false)

  await app.evaluate(() => {
    const ctx = (globalThis as any).__obsrv
    ctx.session.setPainting(true)
    ctx.target.setViewport(1280, 800, 1)
  })
  await expect.poll(painting, { timeout: 10_000 }).toBe(true)
})

test('re-pointing the bus rebinds the source rather than stacking listeners', async () => {
  const frameListeners = (): Promise<number> =>
    app.evaluate(() => (globalThis as any).__obsrv.target.listenerCount('frame'))

  expect(await frameListeners()).toBe(1)

  // Re-pointing at the source it already has exercises exactly the unbind and
  // rebind that activation does, without a second session to build. A `bind`
  // that subscribed without unsubscribing would show up here as 2, then 3, and
  // in the app as every paint delivered once per tab ever activated.
  await app.evaluate(() => {
    const ctx = (globalThis as any).__obsrv
    ctx.bus.setSource(ctx.target)
    ctx.bus.setSource(ctx.target)
  })

  expect(await frameListeners()).toBe(1)
})

test('re-pointing the bus fills the canvas without waiting for a repaint', async () => {
  // The target is showing a static page: it has no reason of its own to paint
  // again. Anything the collector sees came from `setSource`'s invalidate.
  await page.evaluate(() => {
    const w = window as any
    if (w.__off) w.__off()
    w.__frames = []
    w.__off = window.obsrv.onFrame(() => w.__frames.push(1))
  })
  await page.waitForTimeout(300)
  await page.evaluate(() => ((window as any).__frames.length = 0))

  await app.evaluate(() => {
    const ctx = (globalThis as any).__obsrv
    ctx.bus.setSource(ctx.target)
  })

  await page.waitForFunction(() => (window as any).__frames.length > 0, undefined, { timeout: 5_000 })
})

/**
 * The one that matters. `ipcMain.on` is process-global: before the router,
 * every `SyncBus` saw every tab's `syncScroll`, so a scroll in a background tab
 * moved the tab in front and vice versa — silently, with nothing to attribute
 * it to. Both directions are asserted, because a router that drops everything
 * would satisfy "the other tab did not move" perfectly.
 */
test.describe('scroll isolation', () => {
  const TALL = pathToFileURL(resolve(__dirname, '../fixtures/tall.html')).href

  /** Read straight from the pane's page, not from anything we told it. */
  const scrollY = (id: string, pane: 'native' | 'target'): Promise<number> =>
    app.evaluate((_electron, arg: { id: string; pane: string }) => {
      const ctx = (globalThis as any).__obsrv
      const session = ctx.tabs.tabs.find((t: any) => t.id === arg.id)
      if (!session) throw new Error(`no tab ${arg.id}`)
      return session[arg.pane].webContents.executeJavaScript('window.scrollY') as Promise<number>
    }, { id, pane })

  const scrollTo = (id: string, pane: 'native' | 'target', y: number): Promise<void> =>
    app.evaluate((_electron, arg: { id: string; pane: string; y: number }) => {
      const ctx = (globalThis as any).__obsrv
      const session = ctx.tabs.tabs.find((t: any) => t.id === arg.id)
      if (!session) throw new Error(`no tab ${arg.id}`)
      return session[arg.pane].webContents.executeJavaScript(`window.scrollTo(0, ${arg.y})`) as Promise<void>
    }, { id, pane, y })

  let a = ''
  let b = ''

  test.beforeAll(async () => {
    a = await app.evaluate(() => (globalThis as any).__obsrv.tabs.activeId as string)
    // Both tabs are navigated through the renderer's own `navigate`, which
    // drives whichever session is active — so this also proves `registerIpc`
    // follows the manager rather than the session it booted with.
    await page.evaluate(u => window.obsrv.navigate(u), TALL)
    b = await app.evaluate(() => {
      const ctx = (globalThis as any).__obsrv
      const session = ctx.tabs.add()
      if (!session) throw new Error('the tab cap refused a second tab')
      ctx.tabs.activate(session.id)
      return session.id as string
    })
    await page.evaluate(u => window.obsrv.navigate(u), TALL)
    await app.evaluate((_electron, id: string) => (globalThis as any).__obsrv.tabs.activate(id), a)

    // Both panes of both tabs must actually be scrollable, or "it did not
    // move" would be true for a reason that has nothing to do with routing.
    for (const id of [a, b]) {
      for (const pane of ['native', 'target'] as const) {
        await expect
          .poll(
            () =>
              app.evaluate((_electron, arg: { id: string; pane: string }) => {
                const ctx = (globalThis as any).__obsrv
                const session = ctx.tabs.tabs.find((t: any) => t.id === arg.id)
                return session[arg.pane].webContents.executeJavaScript(
                  'document.documentElement.scrollHeight - window.innerHeight',
                ) as Promise<number>
              }, { id, pane }),
            { timeout: 10_000, message: `${id}/${pane} should have somewhere to scroll` },
          )
          .toBeGreaterThan(1_000)
      }
    }
  })

  test.afterAll(async () => {
    await app.evaluate((_electron, id: string) => (globalThis as any).__obsrv.tabs.close(id), b)
  })

  test('a scroll in the active tab does not move the background tab', async () => {
    await scrollTo(a, 'native', 800)
    await expect.poll(() => scrollY(a, 'target'), { timeout: 5_000 }).toBe(800)
    expect(await scrollY(b, 'native')).toBe(0)
    expect(await scrollY(b, 'target')).toBe(0)
  })

  test('a scroll in the background tab mirrors within it and does not move the active tab', async () => {
    await scrollTo(b, 'native', 1600)
    await expect.poll(() => scrollY(b, 'target'), { timeout: 5_000 }).toBe(1600)
    expect(await scrollY(a, 'native')).toBe(800)
    expect(await scrollY(a, 'target')).toBe(800)
  })
})

test('the router resolves every pane to its own tab, and nothing else', async () => {
  // The resolution the two `ipcMain` listeners depend on. A message from a
  // webContents that belongs to no session — the app's own renderer, most of
  // all — must be dropped rather than attributed to a tab: misrouting is what
  // corrupts silently, a dropped message is only a dropped message.
  const owners = await app.evaluate(() => {
    const ctx = (globalThis as any).__obsrv
    const extra = ctx.tabs.add()
    if (!extra) throw new Error('the tab cap refused a second tab')
    const owner = (wc: any): string | null => ctx.tabs.byWebContents(wc)?.id ?? null
    const seen = ctx.tabs.tabs.map((t: any) => ({
      id: t.id,
      native: owner(t.native.webContents),
      target: owner(t.target.webContents),
    }))
    const renderer = owner(ctx.win.webContents)
    ctx.tabs.close(extra.id)
    return { seen, renderer }
  })

  expect(owners.seen.length).toBeGreaterThan(1)
  for (const t of owners.seen) {
    expect(t.native).toBe(t.id)
    expect(t.target).toBe(t.id)
  }
  expect(owners.renderer).toBeNull()
})
