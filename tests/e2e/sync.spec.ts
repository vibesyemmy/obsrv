import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { launchApp, rendererWindow } from './launch'

const TALL = pathToFileURL(resolve(__dirname, '../fixtures/tall.html')).href
const HAIRLINE = pathToFileURL(resolve(__dirname, '../fixtures/hairline.html')).href
const REDIRECT = pathToFileURL(resolve(__dirname, '../fixtures/redirect.html')).href
const LOOP = pathToFileURL(resolve(__dirname, '../fixtures/loop.html')).href
const LOOP_SLOW = pathToFileURL(resolve(__dirname, '../fixtures/loop-slow.html')).href

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
  // The previous test's mirror ran native -> target; a single reversal like
  // this one must pass the loop breaker untouched.
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

test('quick legitimate reversals are not a loop: three navigations back and forth within a second all mirror', async () => {
  // Two test navigations 140 ms apart followed by a redirect used to trip the
  // breaker on a fast runner, and the target then sat on the page it already
  // showed. A loop bounces — a pane commits something else within a beat of
  // the load it was mirrored — and these do not: each navigation is a
  // person's (or a spec's), so every one of them must reach the other pane.
  const CONTRAST = pathToFileURL(resolve(__dirname, '../fixtures/contrast.html')).href
  const steps: [pane: 'native' | 'target', url: string][] = [
    ['native', TALL],
    ['target', HAIRLINE],
    ['native', CONTRAST],
    ['target', TALL],
  ]
  for (const [pane, url] of steps) {
    await app.evaluate(async (_electron, [p, u]: [string, string]) => {
      await (globalThis as any).__obsrv[p].load(u)
    }, [pane, url] as [string, string])
    await expect.poll(() => urls(app), { timeout: 5_000 }).toEqual({ native: url, target: url })
  }
})

async function expectLoopBrokenOnce(loopUrl: string): Promise<void> {
  await app.evaluate(() => {
    const g = globalThis as any
    g.__warns = [] as string[]
    g.__warn = console.warn
    console.warn = (...a: unknown[]) => {
      g.__warns.push(a.map(String).join(' '))
      g.__warn(...a)
    }
    // Count cross-document commits: the fixture's own `replaceState` is a
    // same-document navigation (`did-navigate-in-page`), not a mirror, and a
    // mirrored load superseded before it commits never bounced anything.
    g.__loads = { native: 0, target: 0 }
    g.__onNative = () => g.__loads.native++
    g.__onTarget = () => g.__loads.target++
    g.__obsrv.native.webContents.on('did-navigate', g.__onNative)
    g.__obsrv.target.webContents.on('did-navigate', g.__onTarget)
  })

  await page.evaluate(u => window.obsrv.navigate(u), loopUrl)
  await expect.poll(() => app.evaluate(() => (globalThis as any).__warns.length), { timeout: 10_000 }).toBe(1)

  // Let the loads in flight at the trip land and the breaker's window reset,
  // then check the panes stay put: the loop must not pick up again once the
  // window has passed.
  await new Promise(r => setTimeout(r, 1_200))
  const before = await urls(app)
  await new Promise(r => setTimeout(r, 500))
  const after = await urls(app)
  expect(after).toEqual(before)
  expect(after.native.startsWith(loopUrl)).toBe(true)
  expect(after.target.startsWith(loopUrl)).toBe(true)

  const seen = await app.evaluate(() => {
    const g = globalThis as any
    console.warn = g.__warn
    g.__obsrv.native.webContents.off('did-navigate', g.__onNative)
    g.__obsrv.target.webContents.off('did-navigate', g.__onTarget)
    return { warns: g.__warns as string[], loads: g.__loads as { native: number; target: number } }
  })
  expect(seen.warns).toHaveLength(1)
  expect(seen.warns[0]).toContain('mirror loop broken')
  // One explicit load per pane; then the breaker allows one reversal, and a
  // mirrored load can bounce back twice (the URL, then its rewrite) — so at
  // most one mirror out, four back, and the reversing third alternation is
  // the one dropped.
  expect(seen.loads.native + seen.loads.target - 2).toBeLessThanOrEqual(5)
}

test('a page that rewrites its own URL trips the loop breaker, once', async () => {
  await expectLoopBrokenOnce(LOOP)
})

// The CI runner's shape of the same loop: each hop took ~330 ms there, and a
// bounce window of 300 ms let it run (15 and 17 mirrored loads, 2026-09-03).
// A rewrite that lands 400 ms after the load must still read as a bounce.
test('a page that rewrites its URL a beat after load trips the loop breaker too', async () => {
  await expectLoopBrokenOnce(LOOP_SLOW)
})
