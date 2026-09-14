import { test, expect, type ElectronApplication } from '@playwright/test'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { launchApp, rendererWindow } from './launch'

/**
 * A mirrored commit is reported and marked, rather than withheld.
 *
 * It used to be withheld from `url-changed` entirely, which made
 * `sync.spec`'s redirect test depend on a race: the flag is only set while
 * `load()` is in flight, so a client-side redirect's second commit landed
 * inside that window on a slow machine and outside it on a fast one. That
 * test saw one commit locally and none on CI, from identical code, and failed
 * both attempts on a contended runner (2026-09-14).
 *
 * **Its own file, with its own app, on purpose.** `sync.spec` shares one app
 * across its tests and the loop breaker counts direction reversals within a
 * 3 s window, so a test that drives four commits and hands over perturbs
 * whoever runs next: dropped into that file, this one made
 * "quick legitimate reversals are not a loop" fail half its runs. Timing the
 * handover did not fix it; not sharing the app does.
 */
let app: ElectronApplication
const HAIRLINE = pathToFileURL(resolve(__dirname, '../fixtures/hairline.html')).href
const REDIRECT = pathToFileURL(resolve(__dirname, '../fixtures/redirect.html')).href

const urls = (a: ElectronApplication): Promise<{ native: string; target: string }> =>
  a.evaluate(() => {
    const g = globalThis as any
    return { native: g.__obsrv.native.webContents.getURL(), target: g.__obsrv.target.webContents.getURL() }
  })

test.beforeAll(async () => {
  app = await launchApp()
  await rendererWindow(app)
})
test.afterAll(async () => {
  await app.close()
})

test('a mirrored commit is reported and marked, not withheld', async () => {
  const page = await rendererWindow(app)
  await page.evaluate(u => window.obsrv.navigate(u), HAIRLINE)
  await expect.poll(() => urls(app), { timeout: 5_000 }).toEqual({ native: HAIRLINE, target: HAIRLINE })

  const seen: Array<{ url: string; mirrored: boolean }> = await app.evaluate(async (_e, url: string) => {
    const g = globalThis as any
    g.__marks = [] as Array<{ url: string; mirrored: boolean }>
    g.__onMark = (u: string, _inPage: boolean, mirrored: boolean) => g.__marks.push({ url: u, mirrored })
    g.__obsrv.target.on('url-changed', g.__onMark)
    await g.__obsrv.native.load(url)
    await new Promise(r => setTimeout(r, 1_000))
    g.__obsrv.target.off('url-changed', g.__onMark)
    return g.__marks
  }, REDIRECT)

  // Both commits reported. Withholding them is what made the redirect test
  // depend on which side of `load()` the second one landed.
  expect(seen.map(s => s.url)).toEqual([REDIRECT, HAIRLINE])
  // The bus's own load is the bus's doing, which is what keeps it out of the
  // arrivals count behind "navigated after it loaded".
  expect(seen[0]).toEqual({ url: REDIRECT, mirrored: true })
  // `seen[1]`'s attribution is deliberately not asserted, and the reason is
  // the point rather than an omission: two causes race for that commit and
  // both are truthful. The mirrored document replaces itself, and the native
  // pane — which redirected too — has its own replacement mirrored in behind
  // it. Whichever lands first is what the target reports, so it reads
  // `mirrored: true` on some runs and `false` on others. Asserting either
  // would be asserting the race; this test is for the commit being *reported
  // at all*, which is what withholding it broke.
})
