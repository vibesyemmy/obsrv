import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { launchApp, openOverflow, rendererWindow } from './launch'

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

/**
 * The strip itself. Everything here goes through the DOM the user actually
 * clicks: a strip driven by `tabs.activate` from main would pass while the
 * buttons were wired to nothing.
 */
test.describe('the tab strip', () => {
  const tabs = () => page.locator('.chrome-tabs [role="tab"]')
  const activeTab = () => page.locator('.chrome-tabs [role="tab"][aria-selected="true"]')
  const newTab = () => page.locator('.tab-new')

  /**
   * The cap, moved through the Settings drawer's own number field so both the
   * strip's `disabled` and main's `tabs.maxTabs` follow the way they do for a
   * user. Reading it back from main is what proves the commit landed.
   */
  const setMaxTabs = async (maxTabs: number): Promise<void> => {
    await openOverflow(page)
    await page.click('.overflow-menu .toggle-settings')
    await expect(page.locator('.drawer .max-tabs')).toHaveCount(1)
    await page.fill('.max-tabs', String(maxTabs))
    await page.press('.max-tabs', 'Enter')
    await expect
      .poll(() => app.evaluate(() => (globalThis as any).__obsrv.tabs.maxTabs as number))
      .toBe(maxTabs)
    await openOverflow(page)
    await page.click('.overflow-menu .toggle-settings')
    await expect(page.locator('.drawer')).toHaveCount(0)
  }

  /** Back to one tab, whatever the test before left behind. */
  const resetToOne = async (): Promise<void> => {
    await app.evaluate(() => {
      const ctx = (globalThis as any).__obsrv
      for (const t of [...ctx.tabs.tabs]) if (t.id !== ctx.tabs.activeId) ctx.tabs.close(t.id)
    })
    await expect(tabs()).toHaveCount(1)
  }

  test.beforeEach(resetToOne)
  test.afterAll(resetToOne)

  test('shows one tab at boot, above the browse row', async () => {
    await expect(tabs()).toHaveCount(1)
    await expect(activeTab()).toHaveCount(1)
    // A tab that has been nowhere says so, rather than wearing the
    // `about:blank` every session starts on.
    await expect(newTab()).toBeEnabled()

    const [strip, browse] = await Promise.all([
      page.locator('.chrome-tabs').boundingBox(),
      page.locator('.chrome-browse').boundingBox(),
    ])
    expect(strip!.y + strip!.height).toBeLessThanOrEqual(browse!.y)
  })

  test('a new tab is added at the end and takes the front, and the first tab keeps its screen', async () => {
    await page.selectOption('.preset-select', '1440p-27')
    await expect.poll(() => page.inputValue('.preset-select')).toBe('1440p-27')

    await newTab().click()
    await expect(tabs()).toHaveCount(2)
    // The new one is last in the strip and is the one selected — and it is
    // labelled as new, not as the `about:blank` its panes actually hold.
    await expect(tabs().nth(1)).toHaveAttribute('aria-selected', 'true')
    await expect(tabs().nth(1)).toHaveText('New tab')
    await expect.poll(() => page.inputValue('.preset-select')).toBe('1080p-24')

    // Back to the first: its own screen is still there, untouched by the tab
    // that was opened over it.
    await tabs().nth(0).click()
    await expect(tabs().nth(0)).toHaveAttribute('aria-selected', 'true')
    await expect.poll(() => page.inputValue('.preset-select')).toBe('1440p-27')
    // And main followed the click, not just the strip.
    await expect
      .poll(() => app.evaluate(() => (globalThis as any).__obsrv.session.presetId as string))
      .toBe('1440p-27')
  })

  test('closing the active tab activates its right neighbour', async () => {
    await newTab().click()
    await newTab().click()
    await expect(tabs()).toHaveCount(3)

    const ids = await app.evaluate(() =>
      (globalThis as any).__obsrv.tabs.tabs.map((t: any) => t.id as string),
    )
    await tabs().nth(1).click()
    await expect(tabs().nth(1)).toHaveAttribute('aria-selected', 'true')

    await page.locator('.chrome-tabs .tab').nth(1).locator('.tab-close').click()
    await expect(tabs()).toHaveCount(2)
    // The tab that took its screen position, which is the one the eye is on.
    await expect
      .poll(() => app.evaluate(() => (globalThis as any).__obsrv.tabs.activeId as string))
      .toBe(ids[2])
    await expect(tabs().nth(1)).toHaveAttribute('aria-selected', 'true')
  })

  test('closing the last tab leaves one blank tab, not none', async () => {
    await page.selectOption('.preset-select', '1440p-27')
    await expect.poll(() => page.inputValue('.preset-select')).toBe('1440p-27')

    await page.locator('.chrome-tabs .tab').nth(0).locator('.tab-close').click()

    // The window is the app; an empty app with no way back is a trap.
    await expect(tabs()).toHaveCount(1)
    await expect(activeTab()).toHaveCount(1)
    await expect
      .poll(() => app.evaluate(() => (globalThis as any).__obsrv.tabs.tabs.length as number))
      .toBe(1)
    // A fresh tab, not the one that was closed wearing its old screen.
    await expect.poll(() => page.inputValue('.preset-select')).toBe('1080p-24')
  })

  test('the new-tab button is disabled at the cap and says where to raise it', async () => {
    await setMaxTabs(3)
    await newTab().click()
    await newTab().click()
    await expect(tabs()).toHaveCount(3)

    await expect(newTab()).toBeDisabled()
    const title = await newTab().getAttribute('title')
    expect(title).toContain('3')
    expect(title).toContain('Settings')

    // Lowering the cap below the count closes nothing — the tabs are already
    // open, and taking one away to satisfy a preference would lose a session.
    await setMaxTabs(2)
    await expect(tabs()).toHaveCount(3)
    await expect(newTab()).toBeDisabled()

    // And raising it re-enables the button in place; no relaunch.
    await setMaxTabs(12)
    await expect(newTab()).toBeEnabled()
  })

  test('a tab is titled by its page title, and a background tab keeps its own', async () => {
    const LINK = pathToFileURL(resolve(__dirname, '../fixtures/link.html')).href
    const TALL = pathToFileURL(resolve(__dirname, '../fixtures/tall.html')).href

    await page.evaluate(u => window.obsrv.navigate(u), TALL)
    await expect(tabs().nth(0)).toHaveText('tall-fixture')

    await newTab().click()
    await expect(tabs()).toHaveCount(2)
    await page.evaluate(u => window.obsrv.navigate(u), LINK)
    await expect(tabs().nth(1)).toHaveText('link-fixture')
    // The tab behind kept its own title while the one in front took another.
    await expect(tabs().nth(0)).toHaveText('tall-fixture')
  })
})

/**
 * The shortcuts. They are menu items rather than a renderer `keydown` listener
 * because the native pane is an OS-level view outside the renderer's document:
 * a listener there is dead the moment the user clicks the page under test,
 * which is most of the time. That is why `Cmd+L` already goes through the menu.
 *
 * Playwright injects key events straight into a renderer over CDP, and the OS
 * resolves a menu key equivalent long before that — so a `page.keyboard.press`
 * here would prove the opposite of what it looks like it proves. The item's
 * own `click`, which is exactly what the OS invokes when the accelerator
 * fires, is driven instead, with the native pane focused so that nothing in
 * the path can be relying on the renderer holding focus. Moving any of this
 * into the renderer removes the item, and `invoke` throws.
 */
test.describe('the tab shortcuts are application-menu items', () => {
  const tabs = () => page.locator('.chrome-tabs [role="tab"]')

  const item = (id: string): Promise<{ label: string; accelerator: string | null } | null> =>
    app.evaluate(({ Menu }, itemId: string) => {
      const found = Menu.getApplicationMenu()?.getMenuItemById(itemId)
      return found ? { label: found.label, accelerator: found.accelerator ?? null } : null
    }, id)

  const invoke = async (id: string): Promise<void> => {
    // Focused first, every time: an earlier assertion may have clicked the
    // strip, and a shortcut that only works from the strip is the defect.
    await app.evaluate(() => (globalThis as any).__obsrv.native.webContents.focus())
    await app.evaluate(({ Menu }, itemId: string) => {
      const found = Menu.getApplicationMenu()?.getMenuItemById(itemId)
      if (!found) throw new Error(`no menu item "${itemId}" — is the shortcut in the renderer?`)
      found.click()
    }, id)
  }

  const ids = (): Promise<string[]> =>
    app.evaluate(() => (globalThis as any).__obsrv.tabs.tabs.map((t: any) => t.id as string))
  const activeId = (): Promise<string> =>
    app.evaluate(() => (globalThis as any).__obsrv.tabs.activeId as string)

  const resetToOne = async (): Promise<void> => {
    await app.evaluate(() => {
      const ctx = (globalThis as any).__obsrv
      for (const t of [...ctx.tabs.tabs]) if (t.id !== ctx.tabs.activeId) ctx.tabs.close(t.id)
    })
    await expect(tabs()).toHaveCount(1)
  }

  test.beforeEach(resetToOne)
  test.afterAll(resetToOne)

  test('carries the browser accelerators, and leaves Cmd+W to the tab', async () => {
    expect(await item('new-tab')).toEqual({ label: 'New Tab', accelerator: 'CmdOrCtrl+T' })
    expect(await item('close-tab')).toEqual({ label: 'Close Tab', accelerator: 'CmdOrCtrl+W' })
    expect((await item('select-tab-1'))?.accelerator).toBe('CmdOrCtrl+1')
    expect((await item('select-tab-8'))?.accelerator).toBe('CmdOrCtrl+8')
    // Nine is the last tab, not the ninth — the browser convention.
    expect((await item('select-tab-last'))?.accelerator).toBe('CmdOrCtrl+9')
    expect((await item('select-tab-9'))).toBeNull()

    // Closing the window keeps a way out, but not the one that belongs to tabs.
    const closeWindow = await app.evaluate(({ Menu }) => {
      const flat: { role?: string; accelerator?: string }[] = []
      const walk = (list: Electron.MenuItem[]): void => {
        for (const it of list) {
          flat.push({ role: it.role, accelerator: it.accelerator })
          if (it.submenu) walk(it.submenu.items)
        }
      }
      walk(Menu.getApplicationMenu()?.items ?? [])
      return flat.find(i => (i.role ?? '').toLowerCase() === 'close') ?? null
    })
    expect(closeWindow?.accelerator).toBe('Shift+CmdOrCtrl+W')
  })

  test('Cmd+T opens a tab in front and Cmd+W closes it, with the native pane focused', async () => {
    const before = await ids()

    await invoke('new-tab')
    await expect(tabs()).toHaveCount(2)
    const opened = (await ids()).at(-1)!
    expect(opened).not.toBe(before[0])
    // "New tab" means the tab you asked for is the one in front, and the strip
    // followed main without being told twice.
    expect(await activeId()).toBe(opened)
    await expect(tabs().nth(1)).toHaveAttribute('aria-selected', 'true')

    await invoke('close-tab')
    await expect(tabs()).toHaveCount(1)
    expect(await ids()).toEqual(before)
  })

  test('Cmd+1 selects the first tab and Cmd+9 the last, whatever the count', async () => {
    await invoke('new-tab')
    await invoke('new-tab')
    const list = await ids()
    expect(list).toHaveLength(3)

    await invoke('select-tab-1')
    await expect.poll(activeId).toBe(list[0])
    await expect(tabs().nth(0)).toHaveAttribute('aria-selected', 'true')

    await invoke('select-tab-last')
    await expect.poll(activeId).toBe(list[2])
    await expect(tabs().nth(2)).toHaveAttribute('aria-selected', 'true')

    await invoke('select-tab-2')
    await expect.poll(activeId).toBe(list[1])

    // A number past the end of a short strip is a no-op, not a crash and not
    // the nearest tab: the user asked for a tab that is not there.
    await invoke('select-tab-8')
    await page.waitForTimeout(100)
    expect(await activeId()).toBe(list[1])
  })

  test('Cmd+W on the last tab leaves a fresh blank one, not an empty window', async () => {
    await page.selectOption('.preset-select', '1440p-27')
    await expect.poll(() => page.inputValue('.preset-select')).toBe('1440p-27')

    await invoke('close-tab')

    await expect(tabs()).toHaveCount(1)
    await expect
      .poll(() => app.evaluate(() => (globalThis as any).__obsrv.win.isDestroyed() as boolean))
      .toBe(false)
    // A fresh tab, not the one that was closed still wearing its old screen.
    await expect.poll(() => page.inputValue('.preset-select')).toBe('1080p-24')
  })
})

/**
 * Persistence, which is the riskiest thing here: it runs at boot, so a bad
 * `tabs.json` must cost the user their tabs and never their app. Each test
 * owns a user-data directory and launches its own app — the shared one above
 * is a single launch, and a single launch cannot prove what survives a quit.
 */
test.describe('tabs come back on relaunch', () => {
  const TALL = pathToFileURL(resolve(__dirname, '../fixtures/tall.html')).href
  const LINK = pathToFileURL(resolve(__dirname, '../fixtures/link.html')).href

  const dirs: string[] = []
  const dir = (): string => {
    const d = mkdtempSync(join(tmpdir(), 'obsrv-restore-'))
    dirs.push(d)
    return d
  }
  test.afterAll(() => {
    while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true })
  })

  const strip = (p: Page) => p.locator('.chrome-tabs [role="tab"]')

  test('restores the urls, the screen and which tab was in front — and not the scroll', async () => {
    const home = dir()
    const first = await launchApp([], {}, home)
    const p1 = await rendererWindow(first)

    await p1.evaluate(u => window.obsrv.navigate(u), TALL)
    await expect(strip(p1).nth(0)).toHaveText('tall-fixture')
    await p1.selectOption('.preset-select', 'laptop-768')
    await expect.poll(() => p1.inputValue('.preset-select')).toBe('laptop-768')

    await p1.locator('.tab-new').click()
    await expect(strip(p1)).toHaveCount(2)
    await p1.evaluate(u => window.obsrv.navigate(u), LINK)
    await expect(strip(p1).nth(1)).toHaveText('link-fixture')

    // Back to the first: the tab in front at quit is the tab in front at boot.
    await strip(p1).nth(0).click()
    await expect(strip(p1).nth(0)).toHaveAttribute('aria-selected', 'true')

    // Scrolled deliberately — this is the thing that must *not* come back.
    await first.evaluate(() =>
      (globalThis as any).__obsrv.native.webContents.executeJavaScript('window.scrollTo(0, 900)'),
    )
    await expect
      .poll(
        () =>
          first.evaluate(() =>
            (globalThis as any).__obsrv.native.webContents.executeJavaScript('window.scrollY'),
          ),
        { timeout: 5_000 },
      )
      .toBe(900)

    // The write is on change, not on quit, so the file is already there.
    await expect.poll(() => existsSync(join(home, 'tabs.json')), { timeout: 5_000 }).toBe(true)
    await first.close()

    const second = await launchApp([], {}, home)
    const p2 = await rendererWindow(second)
    await expect(strip(p2)).toHaveCount(2)
    // Titles come from the pages, so these prove the URLs actually loaded
    // rather than merely being listed.
    await expect(strip(p2).nth(0)).toHaveText('tall-fixture')
    await expect(strip(p2).nth(1)).toHaveText('link-fixture')
    await expect(strip(p2).nth(0)).toHaveAttribute('aria-selected', 'true')
    // The screen the tab was being viewed on is part of the session, and a
    // restored tab on the wrong screen is a different observation.
    await expect.poll(() => p2.inputValue('.preset-select'), { timeout: 10_000 }).toBe('laptop-768')

    // Restoring a scroll into a page that may have changed underneath is a
    // guess presented as a memory.
    await expect
      .poll(
        () =>
          second.evaluate(() =>
            (globalThis as any).__obsrv.native.webContents.executeJavaScript('window.scrollY'),
          ),
        { timeout: 5_000 },
      )
      .toBe(0)
    await second.close()
  })

  /**
   * The failure that eats a session for good. `s.url` is written by a
   * committed navigation, and a refused connection commits nothing — so a
   * restore against a server that is not up leaves the tab on `about:blank`,
   * and a writer that then persists what it sees replaces the address with a
   * blank. Nothing recovers it: the next launch restores the blank. Opening
   * Obsrv before `npm run dev` is exactly this sequence, which is why the
   * round trip is asserted across three launches rather than two.
   */
  test('a restore that cannot load keeps the address, and the next launch loads it', async () => {
    const home = dir()
    const pageFile = join(home, 'served.html')
    const served = pathToFileURL(pageFile).href
    writeFileSync(pageFile, readFileSync(resolve(__dirname, '../fixtures/tall.html')))

    const up = await launchApp([], {}, home)
    const pUp = await rendererWindow(up)
    await pUp.evaluate(u => window.obsrv.navigate(u), served)
    await expect(strip(pUp).nth(0)).toHaveText('tall-fixture')
    await up.close()

    // The server goes down between launches.
    rmSync(pageFile)
    const down = await launchApp([], {}, home)
    const pDown = await rendererWindow(down)
    // The tab is blank — nothing loaded — but it still knows where it was.
    await expect
      .poll(() => down.evaluate(() => (globalThis as any).__obsrv.tabs.tabs[0].url as string), {
        timeout: 10_000,
      })
      .toBe(served)
    await down.close()
    expect(JSON.parse(readFileSync(join(home, 'tabs.json'), 'utf8')).tabs[0].url).toBe(served)

    // Back up, and the session is where it was left.
    writeFileSync(pageFile, readFileSync(resolve(__dirname, '../fixtures/tall.html')))
    const again = await launchApp([], {}, home)
    const pAgain = await rendererWindow(again)
    await expect(strip(pAgain)).toHaveCount(1)
    await expect(strip(pAgain).nth(0)).toHaveText('tall-fixture')
    await again.close()
  })

  test('a hand-edited tabs.json cannot make the app unlaunchable', async () => {
    const home = dir()
    writeFileSync(
      join(home, 'tabs.json'),
      JSON.stringify({
        // An entry with no usable url, one that is not a URL at all, and a
        // real one. The middle is the interesting case: it opens as a blank
        // tab wearing its own load error, because a bad entry costing a tab is
        // proportionate and costing the app is not.
        tabs: [{ url: 5 }, { url: 'not a url' }, { url: TALL }],
        activeIndex: 9,
      }),
    )

    const app2 = await launchApp([], {}, home)
    const p = await rendererWindow(app2)
    await expect(strip(p)).toHaveCount(2)
    // The index the file asked for is past the end, so the front falls to the
    // first tab rather than to whatever now sits at that position.
    await expect(strip(p).nth(0)).toHaveAttribute('aria-selected', 'true')
    // It wears the address it failed on rather than calling itself new: that
    // string is the only thing that makes the tab recoverable, by hand or by
    // retry, and it is what survives to the next launch.
    await expect(strip(p).nth(0)).toHaveText('not a url')
    await expect(strip(p).nth(1)).toHaveText('tall-fixture')
    await app2.close()
  })

  test('a list longer than the cap is held to the cap', async () => {
    const home = dir()
    writeFileSync(join(home, 'settings.json'), JSON.stringify({ maxTabs: 2 }))
    writeFileSync(
      join(home, 'tabs.json'),
      JSON.stringify({ tabs: [TALL, LINK, TALL, LINK, TALL].map(url => ({ url })), activeIndex: 4 }),
    )

    const app2 = await launchApp([], {}, home)
    const p = await rendererWindow(app2)
    await expect(strip(p)).toHaveCount(2)
    expect(await app2.evaluate(() => (globalThis as any).__obsrv.tabs.tabs.length as number)).toBe(2)
    // Truncation stranded the front tab, so it falls to the first.
    await expect(strip(p).nth(0)).toHaveAttribute('aria-selected', 'true')
    await app2.close()
  })

  test('an absent file opens exactly one blank tab', async () => {
    const app2 = await launchApp([], {}, dir())
    const p = await rendererWindow(app2)
    await expect(strip(p)).toHaveCount(1)
    await expect(strip(p).nth(0)).toHaveText('New tab')
    await app2.close()
  })
})

/**
 * The driven-tab marker. Agent control is off in this app — the whole point,
 * since the marker's first claim is that it says nothing until the loopback
 * server is open — so the toggle is flipped through the overflow menu the way
 * a user flips it, and back off again before the file ends.
 */
test.describe('the driven tab is marked while agent control is on', () => {
  const tabs = () => page.locator('.chrome-tabs [role="tab"]')
  const driven = () => page.locator('.chrome-tabs .tab.driven')
  /** A driven tab that is also the selected one — the only shape allowed. */
  const drivenActive = () => page.locator('.chrome-tabs .tab.driven:has(> [role="tab"][aria-selected="true"])')

  const setAgentControl = async (on: boolean): Promise<void> => {
    await openOverflow(page)
    const box = page.locator('.overflow-menu .agent-toggle input')
    if ((await box.isChecked()) !== on) await box.click()
    await expect(box).toBeChecked({ checked: on })
    await page.keyboard.press('Escape')
    await expect(page.locator('.overflow-menu')).toHaveCount(0)
  }

  let extra: string

  test.beforeAll(async () => {
    extra = await app.evaluate(() => {
      const ctx = (globalThis as any).__obsrv
      const session = ctx.tabs.add()
      ctx.tabs.activate(session.id)
      return session.id as string
    })
    await expect(tabs()).toHaveCount(2)
  })

  test.afterAll(async () => {
    await setAgentControl(false)
    await app.evaluate((_electron, id: string) => (globalThis as any).__obsrv.tabs.close(id), extra)
    await expect(tabs()).toHaveCount(1)
  })

  test('no tab is marked while agent control is off', async () => {
    await expect(driven()).toHaveCount(0)
  })

  test('turning it on marks the active tab, and only that one', async () => {
    await setAgentControl(true)
    await expect(driven()).toHaveCount(1)
    await expect(drivenActive()).toHaveCount(1)
    // The class is only half of it — a class with no rule behind it marks
    // nothing. This reads the pixels the rule actually asks for: a 2px inset
    // rule on the leading edge, no blur radius at all, and `--warn`.
    //
    // Agent control is the one thing in this chrome that is allowed a hue: the
    // marker says an agent is moving the page under the user's hands, which is
    // precisely the "colour means attention" case the style spec carves out.
    // Asserting the token rather than a literal keeps a palette change green;
    // asserting it rather than "achromatic" is what stops it being quietly
    // reverted to grey.
    const shadow = await driven().evaluate(el => getComputedStyle(el).boxShadow)
    expect(shadow).toContain('inset')
    expect(shadow).toContain('2px 0px 0px 0px')
    const warn = await driven().evaluate(el =>
      getComputedStyle(el.ownerDocument.documentElement).getPropertyValue('--warn').trim(),
    )
    const [r, g, b] = /rgba?\((\d+), (\d+), (\d+)/.exec(shadow)!.slice(1).map(Number)
    const hex = `#${[r, g, b].map(n => n.toString(16).padStart(2, '0')).join('')}`
    expect(hex).toBe(warn.toLowerCase())
  })

  test('the marker follows the user to another tab', async () => {
    const first = await app.evaluate(
      (_electron, id: string) =>
        ((globalThis as any).__obsrv.tabs.tabs.find((t: any) => t.id !== id).id as string),
      extra,
    )
    await app.evaluate((_electron, id: string) => (globalThis as any).__obsrv.tabs.activate(id), first)
    await expect(tabs().nth(0)).toHaveAttribute('aria-selected', 'true')
    // Still exactly one, still the selected one — the marker moved rather
    // than accumulating on every tab the agent has ever been pointed at.
    await expect(driven()).toHaveCount(1)
    await expect(drivenActive()).toHaveCount(1)
    await expect(page.locator('.chrome-tabs .tab').nth(0)).toHaveClass(/driven/)
  })

  test('turning it off clears the marker', async () => {
    await setAgentControl(false)
    await expect(driven()).toHaveCount(0)
  })
})
