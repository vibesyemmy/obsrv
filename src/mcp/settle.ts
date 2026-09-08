/**
 * Waiting for a tab to show a page.
 *
 * A preset or a rotation recreates the app's offscreen target and reloads
 * its page. The control confirms the change once a page is back *or on its
 * way* (`pageBack` in controlServer.ts), and a status read in the next beat
 * can still say `about:blank` (or `''`, the recreated target's first
 * answer) with `loading: false` — measured on bbc.com after a flip to a
 * phone preset, whose reload outlasted the apply budget. The snap path has
 * waited for a tab that is neither blank nor loading since 0.43.0; the drive
 * path read its status straight after the flip. This is that wait, with its
 * status source injected so it can be tested against a scripted app.
 */

export interface SettleStatus {
  url: string
  loading: boolean
}

export interface SettleDeps {
  /** One `status` read; null when the app's answer could not be parsed. */
  status: () => Promise<SettleStatus | null>
  sleep: (ms: number) => Promise<void>
  now: () => number
}

export interface SettleOutcome {
  /** True when a read showed a page that was not loading, within the budget. */
  settled: boolean
  /** The last status read, settled or not; null when none could be parsed. */
  last: SettleStatus | null
  reads: number
  ms: number
}

export const SETTLE_POLL_MS = 250

const blank = (url: string): boolean => url === '' || url === 'about:blank'

/** Reads `status` until the tab shows a page and is not loading, or the budget runs out. */
export async function settlePage(deps: SettleDeps, budgetMs: number): Promise<SettleOutcome> {
  const started = deps.now()
  let reads = 0
  let last: SettleStatus | null = null
  for (;;) {
    const s = await deps.status()
    reads++
    if (s) {
      last = s
      if (!s.loading && !blank(s.url)) return { settled: true, last, reads, ms: deps.now() - started }
    }
    if (deps.now() - started >= budgetMs) return { settled: false, last, reads, ms: deps.now() - started }
    await deps.sleep(SETTLE_POLL_MS)
  }
}
