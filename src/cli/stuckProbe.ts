import { STUCK_CHROME_SCRIPT, type StuckBar } from '../shared/stuckChrome'

/**
 * Driving the stuck-chrome controller from outside the page.
 *
 * `installStuckChrome` (shared/stuckChrome.ts) leaves `window.__obsrvChrome`
 * on the page and is driven over four round trips: install, mark at one
 * scroll offset, settle at another, then hide and restore around the bands.
 * Between any two of them the page can replace its own document — ads,
 * consent, a region redirect — and the next call finds nothing to call.
 * nytimes.com did that once: Electron answered "Script failed to execute,
 * this normally means an error was thrown", the warning quoted it, and the
 * sticky header stayed in every band of that report.
 *
 * So every call is guarded on the page side and answers one of three
 * things — a value, "the controller is gone", or the page's own error — and
 * a controller that is gone is reinstalled once, since the page is still
 * there to measure. The page access is injected (`exec`) so this can be
 * tested against a scripted page; the CLI binds it to `executeJavaScript`.
 */

export interface ProbeDeps {
  exec: (code: string) => Promise<unknown>
  /** Scrolls the band host to an offset and answers the offset reached. */
  scrollTo: (y: number) => Promise<number>
  sleep: (ms: number) => Promise<void>
}

/**
 * After scrolling the probe, how long stuck chrome gets to settle before it is
 * measured. Sticky repositioning is synchronous, but a header that animates
 * itself in or out on scroll is not, and measuring it mid-transition would
 * call it moving when it is about to stop.
 */
export const STUCK_PROBE_SETTLE_MS = 200

export type ChromeAnswer = { ok: unknown } | { missing: true } | { error: string }

const guarded = (method: 'mark' | 'settle' | 'hide' | 'restore'): string =>
  `(() => {
    const c = window.__obsrvChrome
    if (!c) return { missing: true }
    try {
      const v = c.${method}()
      return { ok: v === undefined ? null : v }
    } catch (e) {
      return { error: String((e && e.message) || e) }
    }
  })()`

const isAnswer = (v: unknown): v is ChromeAnswer => typeof v === 'object' && v !== null && ('ok' in v || 'missing' in v || 'error' in v)

/**
 * One controller call, reinstalling the controller once when the page has
 * dropped it. A second `missing` is the caller's to judge.
 */
export async function callChrome(exec: ProbeDeps['exec'], method: 'mark' | 'settle' | 'hide' | 'restore'): Promise<ChromeAnswer> {
  const first = await exec(guarded(method))
  if (!isAnswer(first)) return { error: `the page answered ${method} with ${JSON.stringify(first)}` }
  if (!('missing' in first)) return first
  await exec(STUCK_CHROME_SCRIPT)
  const second = await exec(guarded(method))
  return isAnswer(second) ? second : { error: `the page answered ${method} with ${JSON.stringify(second)}` }
}

/**
 * Which chrome is stuck to the viewport, measured rather than read off
 * `position`: an element whose rect is the same at two scroll offsets past
 * the first band is stuck, whatever CSS put it there. Two scrolls, two
 * probes, no captures. Returns an empty list rather than guessing whenever
 * the two offsets cannot be told apart, and — with a warning that names the
 * cause — whenever the page would not be measured.
 */
export async function findStuckChrome(deps: ProbeDeps, bandPage: number, warn: (message: string) => void): Promise<StuckBar[]> {
  const fail = (why: string): StuckBar[] => {
    warn(`warning: could not measure chrome stuck to the viewport, so the bands keep it: ${why}`)
    return []
  }
  try {
    await deps.exec(STUCK_CHROME_SCRIPT)
    // Once, and once more if the page replaced its document between the
    // mark and the settle: a mark from the old document means nothing to
    // the new one, so the second attempt marks again.
    for (let attempt = 0; attempt < 2; attempt++) {
      const first = await deps.scrollTo(Math.round(bandPage))
      await deps.sleep(STUCK_PROBE_SETTLE_MS)
      const marked = await callChrome(deps.exec, 'mark')
      if ('missing' in marked) return fail('the page replaced its document twice during the probe')
      if ('error' in marked) return fail(`mark threw: ${marked.error}`)
      const second = await deps.scrollTo(Math.round(bandPage * 2))
      await deps.sleep(STUCK_PROBE_SETTLE_MS)
      if (Math.abs(second - first) < 1) return []
      const settled = await deps.exec(guarded('settle'))
      if (!isAnswer(settled)) return fail(`the page answered settle with ${JSON.stringify(settled)}`)
      if ('error' in settled) return fail(`settle threw: ${settled.error}`)
      if ('missing' in settled) {
        if (attempt === 1) return fail('the page replaced its document twice during the probe')
        warn('warning: the page replaced its document during the probe; measured again')
        await deps.exec(STUCK_CHROME_SCRIPT)
        continue
      }
      return settled.ok as StuckBar[]
    }
    return []
  } catch (e) {
    // A page that refuses the probe still gets captured; the bands just keep
    // their chrome, which is what they did before this existed.
    return fail(e instanceof Error ? e.message : String(e))
  }
}
