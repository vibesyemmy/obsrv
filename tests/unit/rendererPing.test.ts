import { describe, expect, it } from 'vitest'
import type { ElectronApplication } from '@playwright/test'
import { armRendererPing } from '../../tests/e2e/helpers/rendererPing'

/**
 * `bug-controls-blur-timeout`'s instrument, counted rather than reasoned about.
 *
 * `misses()` is the one number the next occurrence gets read by, and the doc
 * comment says it counts **pings**. A ping that is answered late produces two
 * events — the deadline passing, and the answer arriving — and both were
 * incrementing it, so one slow ping read as two. Found by Henry on `#229`.
 *
 * A stub stands in for the app: the helper only ever calls `evaluate`, and what
 * is under test is the counting, not Electron.
 */
const stubApp = (respondAfterMs: number): ElectronApplication =>
  ({
    evaluate: () => new Promise(resolve => setTimeout(() => resolve('ok'), respondAfterMs)),
  }) as unknown as ElectronApplication

describe('armRendererPing counts pings, not events', () => {
  it('counts a late-but-answered ping once, not once per event', async () => {
    // One ping only: `everyMs` outlives the test, so nothing else can add to
    // the count and the number below is about this single round trip.
    const ping = armRendererPing(stubApp(1500), 'test', 60_000, 1000)
    await new Promise(r => setTimeout(r, 2000))
    ping.stop()
    expect(ping.misses(), 'a single late ping counted more than once').toBe(1)
  }, 10_000)

  it('counts a ping still unanswered at the deadline once, and does not double it later', async () => {
    // The same ping, read before its answer arrives: the deadline has passed,
    // so it counts — and the answer landing afterwards must not add a second.
    const ping = armRendererPing(stubApp(1500), 'test', 60_000, 1000)
    await new Promise(r => setTimeout(r, 1200))
    expect(ping.misses(), 'the deadline should have counted exactly one').toBe(1)
    await new Promise(r => setTimeout(r, 800))
    ping.stop()
    expect(ping.misses(), 'the late answer added a second count for the same ping').toBe(1)
  }, 10_000)

  it('counts nothing when the answer is prompt', async () => {
    // The control that makes the two above mean something: a detector that
    // always counts is not measuring lateness.
    const ping = armRendererPing(stubApp(10), 'test', 60_000, 1000)
    await new Promise(r => setTimeout(r, 1200))
    ping.stop()
    expect(ping.misses()).toBe(0)
    expect(ping.rejections()).toBe(0)
  }, 10_000)
})
