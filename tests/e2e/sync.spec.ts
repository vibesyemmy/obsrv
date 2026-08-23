import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { launchApp, rendererWindow } from './launch'

const TALL = pathToFileURL(resolve(__dirname, '../fixtures/tall.html')).href
const HAIRLINE = pathToFileURL(resolve(__dirname, '../fixtures/hairline.html')).href
const REDIRECT = pathToFileURL(resolve(__dirname, '../fixtures/redirect.html')).href

/**
 * SyncBus drops a mirror that reverses direction within this long of the
 * previous one (its SPA loop breaker — see `LOOP_WINDOW_MS` in syncBus.ts).
 * A test that navigates one pane right after the other pane's commit was
 * mirrored must let the window pass first, or it is testing the breaker.
 */
const LOOP_WINDOW_MS = 1_000

let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  app = await launchApp()
  page = await rendererWindow(app)
})
test.afterAll(async () => {
  await app.close()
})

type Pane = 'native' | 'target'

function scrollY(a: ElectronApplication, pane: Pane): Promise<number> {
  return a.evaluate((_electron, p: string) => {
    return (globalThis as any).__obsrv[p].webContents.executeJavaScript('window.scrollY') as Promise<number>
  }, pane)
}

/**
 * Scrolls one pane, waits (bounded) for the other to arrive, and returns
 * where both ended up. Polling rather than sleeping: the mirror is a few
 * milliseconds on an idle machine and the bound only matters under load.
 */
async function scrollAndRead(
  a: ElectronApplication,
  which: Pane,
  y: number,
): Promise<{ native: number; target: number }> {
  await a.evaluate(async (_electron, arg: { which: string; y: number }) => {
    const ctx = (globalThis as any).__obsrv
    await ctx[arg.which].webContents.executeJavaScript(`window.scrollTo(0, ${arg.y})`)
  }, { which, y })
  const other: Pane = which === 'native' ? 'target' : 'native'
  await expect
    .poll(() => scrollY(a, other), { timeout: 5_000, message: `${other} should follow ${which} to ${y}` })
    .toBe(y)
  return { native: await scrollY(a, 'native'), target: await scrollY(a, 'target') }
}

function urls(a: ElectronApplication): Promise<{ native: string; target: string }> {
  return a.evaluate(() => {
    const ctx = (globalThis as any).__obsrv
    return { native: ctx.native.webContents.getURL(), target: ctx.target.webContents.getURL() }
  })
}

test('scrolling the native pane moves the target', async () => {
  await page.evaluate(u => window.obsrv.navigate(u), TALL)
  await new Promise(r => setTimeout(r, 500))

  const at = await scrollAndRead(app, 'native', 1200)
  expect(at.native).toBe(1200)
  expect(at.target).toBe(1200)
})

test('scrolling the target moves the native pane', async () => {
  const at = await scrollAndRead(app, 'target', 2400)
  expect(at.target).toBe(2400)
  expect(at.native).toBe(2400)
})

test('repeated scrolls keep tracking, so the bus is not jammed by echoes', async () => {
  const first = await scrollAndRead(app, 'native', 300)
  expect(first.target).toBe(300)

  const second = await scrollAndRead(app, 'native', 900)
  expect(second.target).toBe(900)

  const third = await scrollAndRead(app, 'target', 150)
  expect(third.native).toBe(150)
})

test('navigating the native pane pulls the target along', async () => {
  await app.evaluate((_electron, url: string) => (globalThis as any).__obsrv.native.load(url), HAIRLINE)
  await expect.poll(() => urls(app), { timeout: 5_000 }).toEqual({ native: HAIRLINE, target: HAIRLINE })
})

test('navigating the target pulls the native pane along', async () => {
  // The previous test's mirror ran native -> target; this one reverses it.
  await new Promise(r => setTimeout(r, LOOP_WINDOW_MS))
  await app.evaluate((_electron, url: string) => (globalThis as any).__obsrv.target.load(url), TALL)
  await expect.poll(() => urls(app), { timeout: 5_000 }).toEqual({ native: TALL, target: TALL })
})

test('an explicit navigate loads the target exactly once', async () => {
  await app.evaluate(() => {
    const g = globalThis as any
    g.__starts = 0
    g.__count = () => g.__starts++
    g.__obsrv.target.webContents.on('did-start-navigation', g.__count)
  })

  await page.evaluate(u => window.obsrv.navigate(u), HAIRLINE)
  await new Promise(r => setTimeout(r, 1000))

  const starts = await app.evaluate(() => {
    const g = globalThis as any
    g.__obsrv.target.webContents.off('did-start-navigation', g.__count)
    return g.__starts
  })

  // Without SyncBus.expect, the native pane's did-navigate would mirror the
  // same URL into the target a second time.
  expect(starts).toBe(1)
})

test('a redirecting page leaves no stale expectation behind', async () => {
  // Both panes are told to expect REDIRECT; both commit it and then replace
  // it with HAIRLINE, so neither expectation is met by the URL they end on.
  await page.evaluate(u => window.obsrv.navigate(u), REDIRECT)
  await expect.poll(() => urls(app), { timeout: 5_000 }).toEqual({ native: HAIRLINE, target: HAIRLINE })
  // Whichever pane replaced first mirrored HAIRLINE into the other; the next
  // mirror may run the opposite way, so wait out the loop breaker's window.
  await new Promise(r => setTimeout(r, LOOP_WINDOW_MS))

  // Now the native pane alone goes back to REDIRECT. The target must follow
  // it — through REDIRECT, or straight to its replacement if the mirrored
  // HAIRLINE overtakes — rather than sit on the URL it already shows.
  await app.evaluate(async (_electron, url: string) => {
    const g = globalThis as any
    g.__seen = [] as string[]
    g.__onUrl = (u: string) => g.__seen.push(u)
    g.__obsrv.target.on('url-changed', g.__onUrl)
    await g.__obsrv.native.load(url)
  }, REDIRECT)
  await expect.poll(() => urls(app), { timeout: 5_000 }).toEqual({ native: HAIRLINE, target: HAIRLINE })

  const seen: string[] = await app.evaluate(() => {
    const g = globalThis as any
    g.__obsrv.target.off('url-changed', g.__onUrl)
    return g.__seen
  })
  expect(seen.length).toBeGreaterThanOrEqual(1)
  expect(seen.at(-1)).toBe(HAIRLINE)
})
