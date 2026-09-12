import { describe, expect, it } from 'vitest'
import {
  Deadline,
  measureTimeoutNote,
  httpStatusNote,
  landedElsewhereNote,
  navigatedAfterLoadNote,
  unansweredMeasureMessage,
  walkTimeoutNote,
  withinBudget,
} from '../../src/shared/measureBudget'

describe('measure budget', () => {
  it('a deadline counts down from its budget and passes', () => {
    let t = 1000
    const d = new Deadline(300, () => t)
    expect(d.remaining()).toBe(300)
    t = 1250
    expect(d.remaining()).toBe(50)
    expect(d.passed()).toBe(false)
    t = 1400
    expect(d.remaining()).toBe(0)
    expect(d.passed()).toBe(true)
  })
  it('work that finishes in time is the value; work that does not is a timeout, and its late rejection is swallowed', async () => {
    expect(await withinBudget(Promise.resolve(42), 50)).toEqual({ timedOut: false, value: 42 })
    let reject!: (e: Error) => void
    const stuck = new Promise<number>((_r, rj) => (reject = rj))
    expect(await withinBudget(stuck, 20)).toEqual({ timedOut: true })
    reject(new Error('the page answered late, badly')) // must not become an unhandled rejection
    await new Promise(r => setTimeout(r, 5))
  })
  it('work that rejects in time rejects the caller', async () => {
    await expect(withinBudget(Promise.reject(new Error('navigated')), 50)).rejects.toThrow('navigated')
  })
  it('the notes say what happened, what the figures are, and what to do', () => {
    expect(measureTimeoutNote('audit', 30_000)).toBe(
      'the page did not answer the audit within 30 s of loading: its main thread was busy or blocked — a bot challenge or interstitial, ' +
        'a script waiting on the network — so the figures are of nothing; --timeout (timeoutMs) bounds the load and then the measurement alike, ' +
        'so raise it for a page that answers late, or look at the page with a snap',
    )
    expect(measureTimeoutNote('inspect', 3_000)).toContain('within 3 s of loading')
    expect(measureTimeoutNote('inspect', 3_000)).toContain('so nothing was found')
    // stackoverflow.com: the challenge reloaded the page and then held it past the budget — one sentence, not two that disagree.
    expect(measureTimeoutNote('audit', 30_000, { from: 'https://stackoverflow.com/questions', to: 'https://stackoverflow.com/questions/' })).toContain(
      'its main thread was busy or blocked after navigating to the same address — a bot challenge',
    )
    expect(measureTimeoutNote('lint', 30_000, { from: 'https://a.test/', to: 'https://b.test/x' })).toContain('after navigating to https://b.test/x —')
    expect(walkTimeoutNote(15_000)).toBe('the page did not answer a scroll within 15 s (its main thread was busy or blocked)')
    // Run 13: in dev the cause is usually none of the three this named — a
    // dev server reloading under an edit, an auth redirect, a router replace.
    expect(navigatedAfterLoadNote('https://stackoverflow.com/questions', 'https://stackoverflow.com/questions/')).toBe(
      'the page navigated after it loaded (to the same address): a bot challenge, an interstitial, a redirect, ' +
        'or a dev server reloading under an edit; the figures are of the page it arrived at',
    )
    expect(navigatedAfterLoadNote('file:///a/challenge.html', 'file:///a/audit.html')).toContain(', to file:///a/audit.html: a bot challenge')
  })
})

/**
 * A measurement that comes back empty used to be reported with a guess —
 * "it may have navigated away, or thrown while being measured" — and on
 * reuters.com both halves were false: the page had answered in full and the
 * report was refused on the way in. The reason is known; it should be said.
 */
describe('the sentence for a measurement that came back with nothing', () => {
  it('says so when the page answered but its report was refused', () => {
    const m = unansweredMeasureMessage('lint', 'unparsed')
    expect(m).toContain('the page answered the lint')
    expect(m).toContain('did not pass checking')
    expect(m).not.toContain('may have navigated away')
  })

  it('says so when the ask itself failed', () => {
    expect(unansweredMeasureMessage('audit', 'failed')).toContain('threw while being measured')
  })

  it('names the measurement it is about', () => {
    expect(unansweredMeasureMessage('audit', 'unparsed')).toContain('the audit')
  })

  it('keeps the cautious sentence when nothing more is known', () => {
    expect(unansweredMeasureMessage('lint', 'answered')).toBe(
      'the page did not answer the lint (it may have navigated away, or thrown while being measured)',
    )
  })
})

/**
 * Run 13: a dev server's missing route answered 0 targets and 2 text
 * elements with no warning — the 404 page measured as though it were the
 * page. The status is on the navigation that committed, so the answer can
 * say which page it really measured.
 */
describe('a page the server answered with an error status', () => {
  it('names the status and says the figures are of the error page', () => {
    expect(httpStatusNote(404, 'Not Found', 'http://127.0.0.1:5173/feature')).toBe(
      'the server answered 404 Not Found for http://127.0.0.1:5173/feature: the figures are of the error page it sent, ' +
        'not of the page asked for — check the route, the port, and that the server has it',
    )
  })
  it('leaves the contrast out when the status is for an address other than the one asked for', () => {
    // The redirect sentence has already said "not of the one asked for"; this
    // one repeating it is the same point twice in consecutive lines. The
    // condition is a fact this sentence holds — the status is for a different
    // address — not an inference about whatever precedes it.
    const moved = httpStatusNote(404, 'Not Found', 'https://a.test/missing', 'https://a.test/gone')
    expect(moved).toBe(
      'the server answered 404 Not Found for https://a.test/missing: the figures are of the error page it sent — ' +
        'check the route, the port, and that the server has it',
    )
    // Same address: the contrast is the whole point, since the page asked for
    // is the one that does not exist.
    expect(httpStatusNote(404, 'Not Found', 'https://a.test/x', 'https://a.test/x')).toContain('not of the page asked for')
  })
  it('cannot drop the contrast unless the redirect sentence is there to carry it', () => {
    // The two conditions must not come apart: whenever this note leaves the
    // contrast out, landedElsewhereNote has something to say about the pair.
    for (const [asked, landed] of [
      ['https://a.test/gone', 'https://a.test/missing'],
      ['a.test/gone', 'https://a.test/missing'],
      ['http://127.0.0.1:5173/private', 'http://127.0.0.1:5173/login'],
    ]) {
      const said = httpStatusNote(404, 'Not Found', landed, asked)!
      const dropped = !said.includes('not of the page asked for')
      expect(dropped, `${asked} → ${landed}`).toBe(landedElsewhereNote(asked, landed) !== null)
    }
  })
  it('says the bare code when the server sent no reason', () => {
    expect(httpStatusNote(503, '', 'https://a.test/x')).toContain('the server answered 503 for https://a.test/x:')
  })
  it('is nothing to say for a status that carries a page', () => {
    // 200 and 304 are the page; a 3xx has already become the address it redirected to.
    expect(httpStatusNote(200, 'OK', 'https://a.test/')).toBeNull()
    expect(httpStatusNote(304, 'Not Modified', 'https://a.test/')).toBeNull()
    expect(httpStatusNote(0, '', 'file:///a/fixture.html')).toBeNull()
  })
})

/**
 * Run 14: a dev route that 302s to a login page was measured as though it
 * were the route asked for — two targets where fifty were expected, and no
 * sentence at all. The navigation note covers a move *after* load and the
 * status note covers a 4xx; a redirect during the load that ends in a clean
 * 200 is neither, so the address the load landed on is what has to be said.
 */
describe('a load that landed somewhere else', () => {
  it('names where the figures came from, and what usually causes it', () => {
    expect(landedElsewhereNote('http://127.0.0.1:5173/private', 'http://127.0.0.1:5173/login')).toBe(
      'the load of http://127.0.0.1:5173/private ended at http://127.0.0.1:5173/login: a login wall, a route that has moved, ' +
        'or a redirect the server chose — the figures are of the page it landed on, not of the one asked for',
    )
  })
  it('leaves out a cause the landing page disproves', () => {
    // A landing page that answers 404 was not a login wall. The note holds the
    // status, so the list is narrowed on a fact rather than on the sentence
    // that happens to follow it.
    const onError = landedElsewhereNote('https://a.test/gone', 'https://a.test/missing', 404)!
    expect(onError).toContain('a route that has moved, or a redirect the server chose')
    expect(onError).not.toContain('a login wall')
    // A clean landing keeps the full list: a login page answers 200.
    expect(landedElsewhereNote('https://a.test/private', 'https://a.test/login', 200)).toContain('a login wall')
    expect(landedElsewhereNote('https://a.test/private', 'https://a.test/login')).toContain('a login wall')
  })
  it('is nothing to say for the shapes the loader normalises, which every CLI call goes through', () => {
    // The CLI hands the address on as typed and TargetSource.load normalises
    // it, so the committed URL is routinely a fuller spelling of the same
    // address. Reported as a redirect, `obsrv audit example.com` would say it
    // landed somewhere else on every run.
    expect(landedElsewhereNote('example.com', 'https://example.com/')).toBeNull()
    expect(landedElsewhereNote('localhost:5173', 'http://localhost:5173/')).toBeNull()
    expect(landedElsewhereNote('/tmp/page.html', 'file:///tmp/page.html')).toBeNull()
    // An upgrade to https is not the redirect anyone means by this sentence:
    // it happens on most public addresses and says nothing about the page.
    expect(landedElsewhereNote('http://a.test/x', 'https://a.test/x')).toBeNull()
    // A real move still reads as one, upgrade or not — and both addresses are
    // printed the way the loader spells them, so the two halves of the
    // sentence can be compared by eye.
    expect(landedElsewhereNote('http://a.test/private', 'https://a.test/login')).toContain('ended at https://a.test/login')
    expect(landedElsewhereNote('a.test/private', 'https://a.test/login')).toContain('the load of https://a.test/private')
  })
  it('is nothing to say when the load ended where it was sent', () => {
    expect(landedElsewhereNote('https://a.test/x', 'https://a.test/x')).toBeNull()
    // A trailing slash the server added is not a redirect worth a sentence.
    expect(landedElsewhereNote('https://a.test/x', 'https://a.test/x/')).toBeNull()
    expect(landedElsewhereNote('https://a.test/x', '')).toBeNull()
  })
})
