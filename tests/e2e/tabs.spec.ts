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

/**
 * Image mode is per tab, so a switch changes which mode is in force without
 * any mode changing — and `IPC.setMode`, the only thing that ever wrote
 * `bus.setEnabled`, does not fire. Activation has to re-derive it, exactly as
 * it re-derives native visibility. Left out, leaving an image-mode tab strands
 * the bus disabled and the canvas never receives another frame.
 */
test.describe('bus enablement follows the tab', () => {
  const frames = (): Promise<number> => page.evaluate(() => (window as any).__frames.length as number)
  const reset = (): Promise<void> =>
    page.evaluate(() => {
      ;(window as any).__frames.length = 0
    })
  const activate = (id: string): Promise<void> =>
    app.evaluate((_electron, tabId: string) => (globalThis as any).__obsrv.tabs.activate(tabId), id)

  let live = ''
  let drawn = ''

  test.beforeAll(async () => {
    live = await app.evaluate(() => (globalThis as any).__obsrv.tabs.activeId as string)
    drawn = await app.evaluate(() => {
      const ctx = (globalThis as any).__obsrv
      const session = ctx.tabs.add()
      if (!session) throw new Error('the tab cap refused a second tab')
      ctx.tabs.activate(session.id)
      return session.id as string
    })
    // `setMode` drives whichever tab is active, so this is the second one.
    await page.evaluate(() => window.obsrv.setMode('image'))
    await page.evaluate(() => {
      const w = window as any
      if (w.__off) w.__off()
      w.__frames = []
      w.__off = window.obsrv.onFrame(() => w.__frames.push(1))
    })
  })

  test.afterAll(async () => {
    await activate(drawn)
    await page.evaluate(() => window.obsrv.setMode('url'))
    await activate(live)
    await app.evaluate((_electron, id: string) => (globalThis as any).__obsrv.tabs.close(id), drawn)
  })

  test('leaving an image-mode tab reopens delivery for the tab arrived at', async () => {
    await reset()
    await activate(live)
    // The page is static and has no reason of its own to paint: anything the
    // collector sees came from activation re-enabling the bus and invalidating.
    await page.waitForFunction(() => (window as any).__frames.length > 0, undefined, { timeout: 5_000 })
  })

  test('entering an image-mode tab stops delivery, so target frames cannot overwrite the drawing', async () => {
    await reset()
    await activate(drawn)
    // Activation invalidates the incoming target before the gate closes, so
    // this is not merely "nothing happened": the frame that produces is
    // deliberately dropped on delivery.
    await page.waitForTimeout(600)
    expect(await frames()).toBe(0)
  })
})

/**
 * The forwards main sends the renderer used to be gated on the reporting
 * session being the one in front, because the renderer held one URL bar and
 * one badge. A strip that shows every tab turns that gate into the defect: a
 * background tab could never refresh its own entry, so it would wear whatever
 * it said when it was last in front. The id is what replaced the gate, so both
 * halves are asserted — the background tab reports, and the front tab does not
 * inherit what it said.
 */
test.describe('reports name their tab', () => {
  const LINK = pathToFileURL(resolve(__dirname, '../fixtures/link.html')).href

  let front = ''
  let back = ''

  test.beforeAll(async () => {
    front = await app.evaluate(() => (globalThis as any).__obsrv.tabs.activeId as string)
    // Added and left in the background: the point is a tab nobody is looking at.
    back = await app.evaluate(() => {
      const session = (globalThis as any).__obsrv.tabs.add()
      if (!session) throw new Error('the tab cap refused a second tab')
      return session.id as string
    })
    await page.evaluate(() => {
      const w = window as any
      for (const off of w.__offReports ?? []) off()
      w.__reports = []
      w.__offReports = [
        window.obsrv.onUrlChanged(e => w.__reports.push({ kind: 'url', tabId: e.tabId, value: e.url })),
        window.obsrv.onTitleChanged(e => w.__reports.push({ kind: 'title', tabId: e.tabId, value: e.title })),
      ]
    })
  })

  test.afterAll(async () => {
    await page.evaluate(() => {
      const w = window as any
      for (const off of w.__offReports ?? []) off()
      w.__offReports = []
    })
    await app.evaluate((_electron, id: string) => (globalThis as any).__obsrv.tabs.close(id), back)
  })

  test('a background tab reports its own URL and title, and names itself doing it', async () => {
    const before = await page.inputValue('.url-form input')

    await app.evaluate((_electron, arg: { id: string; url: string }) => {
      const session = (globalThis as any).__obsrv.tabs.tabs.find((t: any) => t.id === arg.id)
      if (!session) throw new Error(`no tab ${arg.id}`)
      return session.native.load(arg.url) as Promise<string>
    }, { id: back, url: LINK })

    // The title is the strip's first choice of label, so it is the one that
    // must arrive — and it must arrive attributed to the tab that navigated.
    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              (window as any).__reports
                .filter((r: any) => r.kind === 'title' && r.value === 'link-fixture')
                .map((r: any) => r.tabId) as string[],
          ),
        { timeout: 10_000 },
      )
      .toEqual([back])

    // Nothing the background tab did was ever attributed to the tab in front.
    const strays = await page.evaluate(
      (id: string) => (window as any).__reports.filter((r: any) => r.tabId === id) as unknown[],
      front,
    )
    expect(strays).toEqual([])
    // And the URL bar, which shows the tab in front, never moved.
    expect(await page.inputValue('.url-form input')).toBe(before)
  })
})

/**
 * Phase two wrote every `uiState` report onto whichever tab was active when it
 * arrived. A report crossing a switch describes the tab being *left*, so the
 * outgoing tab's preset, profile and mode landed on the incoming one and
 * `status` then answered with a screen nobody was looking at. The report names
 * its tab now, and main drops one that names any other.
 */
test.describe('the ui-state mirror belongs to the tab that reported it', () => {
  const mirrored = (): Promise<{ presetId: string; profileId: string }> =>
    app.evaluate(() => {
      const s = (globalThis as any).__obsrv.session
      return { presetId: s.presetId as string, profileId: s.profileId as string }
    })

  const report = (tabId: string, presetId: string): Promise<void> =>
    page.evaluate(
      (arg: { tabId: string; presetId: string }) =>
        window.obsrv.reportUiState({
          tabId: arg.tabId,
          presetId: arg.presetId,
          profileId: 'reference',
          viewMode: 'fit',
          panes: 'both',
          mode: 'url',
        }),
      { tabId, presetId },
    )

  let other = ''

  test.beforeAll(async () => {
    other = await app.evaluate(() => {
      const session = (globalThis as any).__obsrv.tabs.add()
      if (!session) throw new Error('the tab cap refused a second tab')
      return session.id as string
    })
  })

  test.afterAll(async () => {
    await app.evaluate((_electron, id: string) => (globalThis as any).__obsrv.tabs.close(id), other)
  })

  test('drops a report naming a tab that is not in front', async () => {
    const active = await app.evaluate(() => (globalThis as any).__obsrv.tabs.activeId as string)
    await report(active, 'laptop-768')
    await expect.poll(() => mirrored().then(m => m.presetId)).toBe('laptop-768')

    // The shape a switch produces: a report already in flight, describing the
    // tab that has just been left.
    await report(other, 'iphone-61')
    await page.waitForTimeout(200)
    expect((await mirrored()).presetId).toBe('laptop-768')

    // Not merely inert: a report that does name the tab in front still lands.
    await report(active, '1440p-27')
    await expect.poll(() => mirrored().then(m => m.presetId)).toBe('1440p-27')
  })
})

/** The commands behind the strip's three affordances, before the strip exists. */
test.describe('the renderer drives the tab list through main', () => {
  const ids = (): Promise<string[]> =>
    app.evaluate(() => (globalThis as any).__obsrv.tabs.tabs.map((t: any) => t.id as string))

  test('opens a tab in front, switches back, and closes it', async () => {
    const before = await ids()
    const snapshot = await page.evaluate(() => window.obsrv.getTabs())
    expect(snapshot.tabs.map(t => t.id)).toEqual(before)

    const opened = await page.evaluate(() => window.obsrv.addTab())
    expect(opened).not.toBeNull()
    expect(await ids()).toEqual([...before, opened!])
    // "New tab" means the tab you asked for is the one in front.
    expect(await app.evaluate(() => (globalThis as any).__obsrv.tabs.activeId as string)).toBe(opened)

    await page.evaluate((id: string) => window.obsrv.activateTab(id), before[0]!)
    await expect
      .poll(() => app.evaluate(() => (globalThis as any).__obsrv.tabs.activeId as string))
      .toBe(before[0]!)

    await page.evaluate((id: string) => window.obsrv.closeTab(id), opened!)
    await expect.poll(ids).toEqual(before)
  })

  test('ignores a command naming a tab that is not open', async () => {
    const before = await ids()
    const active = await app.evaluate(() => (globalThis as any).__obsrv.tabs.activeId as string)
    await page.evaluate(() => {
      window.obsrv.closeTab('tab-nowhere')
      window.obsrv.activateTab('tab-nowhere')
    })
    await page.waitForTimeout(200)
    expect(await ids()).toEqual(before)
    expect(await app.evaluate(() => (globalThis as any).__obsrv.tabs.activeId as string)).toBe(active)
  })
})
