import { normalizeUrl } from './url'

/**
 * A budget for everything that happens after a page has loaded: the walk,
 * the wait for a document with nothing in it, and the page asks that measure
 * it. `--timeout` bounds the load and, until 0.50.0, nothing else.
 *
 * stackoverflow.com fronts a bot challenge for a new client: the challenge
 * document loads in a second with nothing in it, then holds the renderer's
 * main thread for as long as the challenge takes — ten seconds on a good
 * run, minutes on a bad one, every renderer process at 0 % CPU — and a
 * page ask is one `executeJavaScript` call that cannot return while the
 * main thread is blocked. The audit sat behind it for 142 s, 135 s without
 * the walk, 204 s, and once for over seven minutes; the MCP's kill at 90 s
 * was the only bound, and it threw away an answer that was correct.
 *
 * Pure, so the CLI, the app and the walk share one clock and the notes are
 * unit-tested.
 */

/** A point in time the phase must be done by, with the time left to it. */
export class Deadline {
  readonly at: number
  constructor(
    readonly budgetMs: number,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.at = this.now() + budgetMs
  }
  remaining(): number {
    return Math.max(0, this.at - this.now())
  }
  passed(): boolean {
    return this.remaining() === 0
  }
}

export type Bounded<T> = { timedOut: false; value: T } | { timedOut: true }

/**
 * `work`, or a timeout, whichever is first. The work is not cancelled — an
 * `executeJavaScript` cannot be — so when the timer wins the promise is left
 * to settle on its own, its rejection swallowed, and the caller moves on.
 */
export async function withinBudget<T>(work: Promise<T>, ms: number): Promise<Bounded<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<Bounded<T>>(resolve => {
    timer = setTimeout(() => resolve({ timedOut: true }), Math.max(0, ms))
  })
  try {
    return await Promise.race([work.then(value => ({ timedOut: false, value }) as Bounded<T>), timeout])
  } finally {
    clearTimeout(timer)
    // Settled or not, a later rejection of the abandoned work must not surface.
    work.catch(() => undefined)
  }
}

const seconds = (ms: number): string => `${Math.round(ms / 100) / 10} s`

/**
 * The sentence a measurement carries when the page never answered it within
 * the budget: what happened, what the figures are, and what to do.
 */
export function measureTimeoutNote(what: 'audit' | 'lint' | 'inspect', budgetMs: number, navigated?: { from: string; to: string }): string {
  const where =
    navigated === undefined
      ? ''
      : navigated.from.replace(/\/$/, '') === navigated.to.replace(/\/$/, '')
        ? ' after navigating to the same address'
        : ` after navigating to ${navigated.to}`
  return (
    `the page did not answer the ${what} within ${seconds(budgetMs)} of loading: its main thread was busy or blocked${where} — ` +
    `a bot challenge or interstitial, a script waiting on the network — so ` +
    (what === 'inspect' ? 'nothing was found' : 'the figures are of nothing') +
    `; --timeout (timeoutMs) bounds the load and then the measurement alike, so raise it for a page that answers late, ` +
    `or look at the page with a snap`
  )
}

/** What is known about an ask that came back with no report. */
export type AskOutcome = 'answered' | 'timeout' | 'failed' | 'unparsed'

/**
 * The error for a measurement that came back with nothing. The ask knows
 * which of the three it was, so the sentence says it rather than offering
 * the reader a guess to check: a page that answered in full and had its
 * report refused reads nothing like one that navigated away.
 */
export function unansweredMeasureMessage(what: 'audit' | 'lint', outcome: AskOutcome): string {
  switch (outcome) {
    case 'unparsed':
      return (
        `the page answered the ${what}, but the report did not pass checking on the way in ` +
        `(a value it sent was outside what the measurement accepts), so the figures are of nothing`
      )
    case 'failed':
      return `the page threw while being measured, or went away before it answered the ${what}`
    case 'timeout':
      return `the page did not answer the ${what} within its budget`
    default:
      return `the page did not answer the ${what} (it may have navigated away, or thrown while being measured)`
  }
}

/** The walk's version: a scroll the page never answered. */
export function walkTimeoutNote(budgetMs: number): string {
  return `the page did not answer a scroll within ${seconds(budgetMs)} (its main thread was busy or blocked)`
}

/**
 * A page that navigated after `load` — a challenge that solved and reloaded,
 * an interstitial that moved on, a redirect by script, a dev server reloading
 * under an edit — was measured where it arrived, which the answer says. Run
 * 13 drove a dev server and found the dev causes were the common ones and the
 * sentence named none of them.
 */
export function navigatedAfterLoadNote(from: string, to: string): string {
  const same = from.replace(/\/$/, '') === to.replace(/\/$/, '')
  return (
    `the page navigated after it loaded${same ? ' (to the same address)' : `, to ${to}`}: ` +
    `a bot challenge, an interstitial, a redirect, or a dev server reloading under an edit; ` +
    `the figures are of the page it arrived at`
  )
}

/**
 * A page the server answered with an error status is still a page, and was
 * measured as though it were the one asked for: run 13's dev fixture answered
 * 0 targets and 2 text elements for a missing route, silently. Null when the
 * status carries the page — a 2xx, a 304, and 0 for a navigation with no HTTP
 * status at all (file://, about:blank). A 3xx has already become the address
 * it redirected to, which the navigated note names.
 */
export function httpStatusNote(code: number, statusText: string, url: string, asked?: string): string | null {
  if (code < 400) return null
  const said = statusText.trim() === '' ? `${code}` : `${code} ${statusText.trim()}`
  // "not of the page asked for" is this sentence's whole point when the
  // address that 404s is the one asked for. When the status belongs to some
  // other address the reader has already been told the load landed elsewhere,
  // and saying it again is the same point in consecutive lines. The test is
  // the same `sameAddress` the redirect note uses, so the contrast can never
  // be dropped by a sentence that is not there.
  const contrast = asked === undefined || sameAddress(asked, url) ? 'the figures are of the error page it sent, not of the page asked for' : 'the figures are of the error page it sent'
  return `the server answered ${said} for ${url}: ${contrast} — check the route, the port, and that the server has it`
}

/**
 * A load that was redirected on its way — `/private` answering 302 to
 * `/login`, the ordinary shape of a page behind a login — commits the page it
 * landed on and answers 200 for it, so neither the navigated-after-load note
 * nor the status note has anything to say (run 14, 2026-09-12: two targets
 * where fifty were expected, and silence). Null when the load ended where it
 * was sent, the address only gained the trailing slash the server adds, or
 * nothing committed at all.
 */
function sameAddress(asked: string, landed: string): boolean {
  const bare = (u: string): string => u.replace(/^http:\/\//, 'https://').replace(/\/$/, '')
  let sent = asked
  try {
    sent = normalizeUrl(asked)
  } catch {
    sent = asked
  }
  return bare(sent) === bare(landed)
}

export function landedElsewhereNote(asked: string, landed: string): string | null {
  if (landed === '') return null
  // Compared as the loader spells it, not as it was typed: TargetSource.load
  // normalises (`example.com` → `https://example.com/`), so a raw comparison
  // calls every bare-host call a redirect. An upgrade to https is not one
  // either — it happens on most public addresses and says nothing about which
  // page was measured.
  if (sameAddress(asked, landed)) return null
  let sent = asked
  try {
    sent = normalizeUrl(asked)
  } catch {
    sent = asked
  }
  return (
    `the load of ${sent} ended at ${landed}: a login wall, a route that has moved, or a redirect the server chose — ` +
    `the figures are of the page it landed on, not of the one asked for`
  )
}
