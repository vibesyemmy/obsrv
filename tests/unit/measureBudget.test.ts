import { describe, expect, it } from 'vitest'
import { Deadline, measureTimeoutNote, navigatedAfterLoadNote, walkTimeoutNote, withinBudget } from '../../src/shared/measureBudget'

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
    expect(navigatedAfterLoadNote('https://stackoverflow.com/questions', 'https://stackoverflow.com/questions/')).toBe(
      'the page navigated after it loaded (to the same address): a bot challenge, an interstitial or a redirect; the figures are of the page it arrived at',
    )
    expect(navigatedAfterLoadNote('file:///a/challenge.html', 'file:///a/audit.html')).toContain(', to file:///a/audit.html: a bot challenge')
  })
})
