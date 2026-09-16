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

/**
 * The target inspector's own lifecycle, in order, from this call on. The two
 * guard tests below wait on these, not on `isDevToolsOpened()`: that answers
 * for the request rather than the window, and both toggles are deferred a
 * tick, so a poll for "closed" taken straight after the clicks reads the state
 * before either toggle has run. It did, in every CI run of both tests until
 * 2026-09-16 — each was decided by one sample 500 ms after the clicks, racing
 * an open-then-close that takes 340 ms to 1.4 s on a runner, and a slow runner
 * failed them exactly as a dropped close would (bug-devtools-toggle-reopens).
 */
const recordInspectorEvents = (): Promise<void> =>
  app.evaluate(() => {
    const g = globalThis as any
    const wc = g.__obsrv.target.webContents
    g.__inspectorEvents?.off()
    const events: string[] = []
    const onOpened = (): void => void events.push('opened')
    const onClosed = (): void => void events.push('closed')
    wc.on('devtools-opened', onOpened)
    wc.on('devtools-closed', onClosed)
    g.__inspectorEvents = {
      events,
      off: () => {
        wc.off('devtools-opened', onOpened)
        wc.off('devtools-closed', onClosed)
      },
    }
  })
/** From the first open: the inspector starts closed, so a close before it belongs to the test before. */
const inspectorEvents = (): Promise<string[]> =>
  app.evaluate(() => {
    const events: string[] = (globalThis as any).__inspectorEvents.events
    const first = events.indexOf('opened')
    return first < 0 ? [] : events.slice(first)
  })

test('a toggle that arrives while the inspector is opening is applied when it opens, not dropped', async () => {
  // The in-flight guard used to *drop* such a toggle, which reads as a
  // click that did nothing: on a slow machine the window between
  // `openDevTools()` and `devtools-opened` is wide enough to swallow a
  // close, and CI caught it (0.59.0's bump run, devtools.spec:92 failing
  // its close poll twice at 10 s). Two clicks in one tick put the second
  // inside that window by construction, whatever the machine's speed.
  const opened = (): Promise<boolean> =>
    app.evaluate(() => (globalThis as any).__obsrv.target.webContents.isDevToolsOpened())
  await recordInspectorEvents()
  await app.evaluate(({ Menu }) => {
    const item = Menu.getApplicationMenu()!.getMenuItemById('target-devtools')!
    item.click()
    item.click()
  })
  // Two toggles, so it opens and then closes — the second is honoured once
  // the window exists rather than vanishing. Waiting on the events waits for
  // the window, however long the machine takes to make one.
  await expect.poll(inspectorEvents, { timeout: 10_000 }).toEqual(['opened', 'closed'])
  // And it stays closed: the pending toggle is one, not a queue that
  // re-opens behind it. Timed from the close, not the clicks — a re-open
  // queued behind it is requested as the close settles, and the request
  // flag shows a request at once. That earliness is the property that made
  // the old poll read nothing; here it is what makes 500 ms enough, so the
  // flag stays in this check rather than being swapped for the events.
  await new Promise(r => setTimeout(r, 500))
  expect(await inspectorEvents()).toEqual(['opened', 'closed'])
  expect(await opened()).toBe(false)
  await app.evaluate(() => (globalThis as any).__inspectorEvents.off())
  expect(await app.evaluate(() => 1 + 1)).toBe(2)
})

test('a third toggle while one is already pending does not stack up', async () => {
  const opened = (): Promise<boolean> =>
    app.evaluate(() => (globalThis as any).__obsrv.target.webContents.isDevToolsOpened())
  await recordInspectorEvents()
  await app.evaluate(({ Menu }) => {
    const item = Menu.getApplicationMenu()!.getMenuItemById('target-devtools')!
    item.click()
    item.click()
    item.click()
  })
  // Open, then one pending close — the third click collapses into the
  // second rather than queueing a re-open behind it.
  await expect.poll(inspectorEvents, { timeout: 10_000 }).toEqual(['opened', 'closed'])
  await new Promise(r => setTimeout(r, 500))
  expect(await inspectorEvents()).toEqual(['opened', 'closed'])
  expect(await opened()).toBe(false)
  await app.evaluate(() => (globalThis as any).__inspectorEvents.off())
})
