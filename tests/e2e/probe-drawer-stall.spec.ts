import { test, expect } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp, rendererWindow } from './launch'

/**
 * PROBE for `bug-drawer-stalls-part-open`. Not for main.
 *
 * The card's question, and the one every candidate fix depends on: when the
 * drawer stops about 7% open on a freshly launched app, is the renderer
 * STARVED — and would finish given time — or is it STUCK? `drawerSettled`
 * gives up at 5 s and records nothing afterwards, so neither CI sighting can
 * say, and re-running cannot either.
 *
 * **Why this is one test doing the thing ten times, rather than ten runs.**
 * `ci.yml`'s concurrency group is keyed on the ref with `cancel-in-progress`,
 * so three `workflow run` triggers on one branch give **one** surviving run,
 * not three (measured: the second was `cancelled` before it started). Samples
 * have to come from inside a single run.
 *
 * It measures every attempt, not only the failures. A distribution is the
 * answer here: if a normal settle is ~300 ms and the bad ones are 5 s+ but
 * still land, that is contention; if a bad one never lands in 30 s, it is
 * stuck. Either way the number arrives, which is what the card asked for.
 */
const ATTEMPTS = 10
const WATCH_MS = 30_000

test.describe('PROBE: how long the drawer takes to land on a freshly launched app', () => {
  test.slow()
  const homes: string[] = []
  test.afterAll(() => {
    while (homes.length > 0) rmSync(homes.pop()!, { recursive: true, force: true })
  })

  test('times every open, and watches the failures for thirty seconds', async () => {
    test.setTimeout(ATTEMPTS * 45_000)
    const results: string[] = []
    for (let i = 0; i < ATTEMPTS; i++) {
      const home = mkdtempSync(join(tmpdir(), 'obsrv-drawer-probe-'))
      homes.push(home)
      const app = await launchApp([], {}, home)
      const page = await rendererWindow(app)
      const drawerW = (): Promise<string> =>
        page
          .evaluate(() => getComputedStyle(document.querySelector('.app')!).getPropertyValue('--drawer-w').trim())
          .catch(e => `ERR ${String(e).slice(0, 30)}`)

      const toggle = page.locator('.toggle-panel')
      if ((await toggle.getAttribute('aria-pressed')) !== 'true') await toggle.click()

      const t0 = Date.now()
      let landed = -1
      const trace: string[] = []
      while (Date.now() - t0 < WATCH_MS) {
        const w = await drawerW()
        if (landed < 0 && w === '309px') {
          landed = Date.now() - t0
          break
        }
        // Only record a trace once it is already past the 5 s the real helper
        // allows: before that there is nothing interesting to say.
        if (Date.now() - t0 > 5_000) trace.push(`${Date.now() - t0}ms=${w}`)
        await new Promise(r => setTimeout(r, Date.now() - t0 > 5_000 ? 500 : 25))
      }
      results.push(landed >= 0 ? `${i}:landed@${landed}ms` : `${i}:NEVER[${trace.join(' ')}]`)
      await app.close()
    }
    console.log(`DRAWER PROBE | ${results.join(' | ')}`)
    // The probe reports; it does not judge. A red here would only hide the line.
    expect(results).toHaveLength(ATTEMPTS)
  })
})
