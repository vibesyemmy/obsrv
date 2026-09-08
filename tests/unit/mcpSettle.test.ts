import { describe, expect, it } from 'vitest'
import { SETTLE_POLL_MS, settlePage, type SettleDeps, type SettleStatus } from '../../src/mcp/settle'

/**
 * A preset or a rotation recreates the app's target and reloads its page; the
 * control confirms once a page is back *or on its way*, and a status read in
 * the next beat can still say about:blank with loading false (measured on
 * bbc.com after a phone flip). The snap path waits for a tab that is neither
 * blank nor loading; this is that wait, pulled out so the drive can share it.
 */
function deps(answers: Array<SettleStatus | null>): SettleDeps & { clock: number; slept: number[] } {
  const d = {
    clock: 0,
    slept: [] as number[],
    status: async () => (answers.length > 0 ? answers.shift()! : null),
    sleep: async (ms: number) => {
      d.slept.push(ms)
      d.clock += ms
    },
    now: () => d.clock,
  }
  return d
}

describe('settlePage', () => {
  it('returns at once when the tab already shows a page and is not loading', async () => {
    const d = deps([{ url: 'https://x.test/', loading: false }])
    const r = await settlePage(d, 5000)
    expect(r).toMatchObject({ settled: true, reads: 1, last: { url: 'https://x.test/', loading: false } })
    expect(d.slept).toEqual([])
  })

  it('waits through the blank beat and the load, and hands back the status it settled on', async () => {
    const d = deps([
      { url: 'about:blank', loading: false },
      { url: '', loading: false },
      { url: 'about:blank', loading: true },
      { url: 'https://x.test/', loading: true },
      { url: 'https://x.test/', loading: false },
    ])
    const r = await settlePage(d, 5000)
    expect(r.settled).toBe(true)
    expect(r.reads).toBe(5)
    expect(r.last).toEqual({ url: 'https://x.test/', loading: false })
    expect(d.slept).toEqual([SETTLE_POLL_MS, SETTLE_POLL_MS, SETTLE_POLL_MS, SETTLE_POLL_MS])
  })

  it('gives up at the budget with the last status it saw, and says so', async () => {
    const d = deps(Array.from({ length: 50 }, () => ({ url: 'about:blank', loading: false })))
    const r = await settlePage(d, 1000)
    expect(r.settled).toBe(false)
    expect(r.last).toEqual({ url: 'about:blank', loading: false })
    expect(r.ms).toBeGreaterThanOrEqual(1000)
    expect(r.reads).toBeLessThanOrEqual(6)
  })

  it('a status the app could not parse counts as a read, not a settle', async () => {
    const d = deps([null, { url: 'https://x.test/', loading: false }])
    const r = await settlePage(d, 5000)
    expect(r).toMatchObject({ settled: true, reads: 2 })
  })
})
