import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromium, type Browser } from 'playwright'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * `tests/fixtures/grows-as-walked.html` must grow INSIDE the walk's own return to the top, not at the
 * next frame. It used to grow from a `scroll` listener, and `cli-walk.spec.ts:192` failed on both
 * attempts of `main`'s `#606` push suite because, on a slow runner, the audit took its figures before
 * the listener ran: the page was still six rows tall (`pageHeight=2550`, printed in `#612`'s own suite,
 * where a passing run reads 19550), the 40 rows landed inside the motion probe, and the coverage note
 * never fired. That was a race between a scroll event and a measurement; this file is not.
 *
 * The probe below is `walkStep`'s own shape: screenful moves down with `window.scrollTo({ top,
 * behavior: 'instant' })`, then the move to the top, with the document height read in the SAME
 * synchronous call as the move, because `walkStep` reads `pageHeight` a line after it scrolls. No frame
 * runs between the move and the read, so the result cannot depend on the runner's speed.
 *
 * Needs Chromium (`npx playwright install chromium`, which CI runs before the unit step). Headless and
 * file-only: it opens no window and takes no focus.
 */

const ROOT = join(__dirname, '..', '..')
const FIXTURE = join(ROOT, 'tests', 'fixtures', 'grows-as-walked.html')
let browser: Browser

beforeAll(async () => {
  browser = await chromium.launch({ headless: true })
}, 60_000)
afterAll(async () => {
  await browser?.close()
})

async function walkHeights(url: string) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
  try {
    await page.goto(url)
    return await page.evaluate(async () => {
      const height = () => Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)
      const start = height()
      for (let i = 0; i < 4; i++) {
        const max = Math.max(0, height() - innerHeight)
        window.scrollTo({ top: Math.min(scrollY + innerHeight, max), left: scrollX, behavior: 'instant' })
        // The harness awaits between steps; each step is its own task.
        await new Promise(r => setTimeout(r, 30))
      }
      const atBottom = height()
      window.scrollTo({ top: 0, left: scrollX, behavior: 'instant' })
      const sameCall = height()
      await new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r())))
      return { start, atBottom, sameCall, afterFrames: height() }
    })
  } finally {
    await page.close()
  }
}

describe('grows-as-walked.html grows inside the walk\'s own return to the top', () => {
  it('is already tall when the same call that returned to the top reads the height', async () => {
    const h = await walkHeights('file://' + FIXTURE)
    expect(h.start, 'six rows before the walk').toBeLessThan(3_000)
    expect(h.atBottom, 'the page did not grow before the walk returned').toBe(h.start)
    expect(h.sameCall, 'grown in the same call, no frame needed').toBeGreaterThan(10_000)
    expect(h.afterFrames, 'and nothing grew again afterwards').toBe(h.sameCall)
  }, 60_000)

  it('the control: the listener-based version it replaced reads six rows in that same call', async () => {
    // The old fixture, as a data URL built from the same text with the growth moved back onto a scroll
    // listener. If this ever reads tall, the probe above no longer tells the two apart.
    const html = readFileSync(FIXTURE, 'utf8').replace(
      /const atBottom[\s\S]*?\n {6}\}\n/,
      `addEventListener('scroll', () => {
        if (scrollY + innerHeight >= document.documentElement.scrollHeight - 2) sawBottom = true
        if (sawBottom && !grown && scrollY === 0) { grown = true; add(40) }
      })
`,
    )
    expect(html, 'the control was built from the real fixture').toContain("addEventListener('scroll'")
    expect(html).not.toContain('nativeScrollTo')
    const h = await walkHeights('data:text/html;charset=utf-8,' + encodeURIComponent(html))
    expect(h.sameCall, 'six rows in the same call: the race').toBeLessThan(3_000)
    expect(h.afterFrames, 'and 40 more a frame later').toBeGreaterThan(10_000)
  }, 60_000)
})

describe('the coupling: the walk returns to the top with window.scrollTo', () => {
  it('walkStep still calls window.scrollTo for a root scroller, which is what the fixture wraps', () => {
    const source = readFileSync(join(ROOT, 'src', 'shared', 'scrollHost.ts'), 'utf8')
    expect(source).toMatch(/window\.scrollTo\(\{ top: want,/)
  })
})
