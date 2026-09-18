import { test, expect } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp, rendererWindow } from './launch'

/**
 * PROBE v2 for `bug-drawer-stalls-part-open`. Not for main.
 *
 * **v1 did not reproduce the stall, and that is the finding it bought.** Ten
 * opens on CI (`35393993403`): `240 233 231 237 227 267 321 262 358 340` ms —
 * ten for ten landed, worst 358 ms, against a 5 s poll the real failures blow
 * through entirely. That is the card's FIRST written-down reading, not the
 * second: a 131 ms spread where my laptop gives 10 ms is a CI box being a CI
 * box, and calling it "contention, confirmed" would be picking the bucket that
 * feels like progress.
 *
 * **What v1 left out.** The real failure is `openPanel(p1)` inside
 * `text-scale.spec.ts`'s relaunch test, where the file's `beforeAll` app is
 * still open — so **two Electron apps are alive**, and the drawer being timed
 * belongs to the younger one. v1 closed each app before launching the next and
 * never had two. The one hint in its numbers points the same way: the last
 * four climbed (262, 321, 358, 340) as the run accumulated residue.
 *
 * So this changes **one thing at a time**, alternating within a single run so
 * every arm meets the same machine in the same minute:
 *
 *   A  lone            — v1's shape, the control
 *   B  resident alive  — a second app open and idle while the drawer is timed
 *   C  resident + nav  — as B, and the timed app has navigated first, which is
 *                        what the real test does before it opens the panel
 */
const ROUNDS = 4
const WATCH_MS = 30_000
const PAGE = '<!doctype html><title>probe</title><p style="height:3000px">tall</p>'

test.describe('PROBE v2: does a second live app starve the drawer', () => {
  test.slow()
  const homes: string[] = []
  let server: Server
  let url = ''

  test.beforeAll(async () => {
    server = createServer((_q, res) => {
      res.setHeader('Content-Type', 'text/html')
      res.end(PAGE)
    })
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`
  })
  test.afterAll(async () => {
    while (homes.length > 0) rmSync(homes.pop()!, { recursive: true, force: true })
    await new Promise<void>(r => server.close(() => r()))
  })

  test('times the drawer with and without a second app alive', async () => {
    test.setTimeout(ROUNDS * 3 * 45_000)
    const home = (): string => {
      const d = mkdtempSync(join(tmpdir(), 'obsrv-drawer-probe-'))
      homes.push(d)
      return d
    }

    /** Opens the panel on a freshly launched app and says how long it took to land. */
    const timeDrawer = async (navigateFirst: boolean): Promise<string> => {
      const app = await launchApp([], {}, home())
      const page = await rendererWindow(app)
      if (navigateFirst) {
        await page.evaluate(u => window.obsrv.navigate(u), url)
        await new Promise(r => setTimeout(r, 500))
      }
      const toggle = page.locator('.toggle-panel')
      if ((await toggle.getAttribute('aria-pressed')) !== 'true') await toggle.click()
      const t0 = Date.now()
      let landed = -1
      const trace: string[] = []
      while (Date.now() - t0 < WATCH_MS) {
        const w = await page
          .evaluate(() => getComputedStyle(document.querySelector('.app')!).getPropertyValue('--drawer-w').trim())
          .catch(e => `ERR ${String(e).slice(0, 25)}`)
        if (w === '309px') {
          landed = Date.now() - t0
          break
        }
        if (Date.now() - t0 > 5_000) trace.push(`${Date.now() - t0}ms=${w}`)
        await new Promise(r => setTimeout(r, Date.now() - t0 > 5_000 ? 500 : 25))
      }
      await app.close()
      return landed >= 0 ? `${landed}` : `NEVER[${trace.join(' ')}]`
    }

    const out: string[] = []
    for (let i = 0; i < ROUNDS; i++) {
      out.push(`A${i}=${await timeDrawer(false)}`)

      // B and C share one resident app, opened and left idle exactly as the
      // relaunch test's `beforeAll` app is.
      const resident = await launchApp([], {}, home())
      await rendererWindow(resident)
      out.push(`B${i}=${await timeDrawer(false)}`)
      out.push(`C${i}=${await timeDrawer(true)}`)
      await resident.close()
    }
    console.log(`DRAWER PROBE2 | ${out.join(' ')}`)
    expect(out).toHaveLength(ROUNDS * 3)
  })
})
