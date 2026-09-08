import { describe, expect, it } from 'vitest'
import { STUCK_CHROME_SCRIPT } from '../../src/shared/stuckChrome'
import { callChrome, findStuckChrome, type ProbeDeps } from '../../src/cli/stuckProbe'

/**
 * The stuck-chrome probe drives a controller it leaves on the page over four
 * round trips. nytimes.com once answered the second with "Script failed to
 * execute": the page had replaced its document between them (ads, consent, a
 * region redirect), and `window.__obsrvChrome` was gone — the header stayed
 * in every band, and the warning quoted Electron. The probe now says what
 * was missing, and reinstalls the controller once when the page has dropped
 * it.
 */
const bar = { element: 'header.site', position: 'sticky', top: 0, height: 64 }

/** A page that answers the guarded calls from queues, and counts installs. */
function page(opts: { mark?: unknown[]; settle?: unknown[]; scrollTo?: (y: number) => number } = {}) {
  const marks = opts.mark ?? [{ ok: null }]
  const settles = opts.settle ?? [{ ok: [bar] }]
  const p = {
    installs: 0,
    calls: [] as string[],
    exec: async (code: string): Promise<unknown> => {
      if (code === STUCK_CHROME_SCRIPT) {
        p.installs++
        return 0
      }
      if (code.includes('c.mark(')) {
        p.calls.push('mark')
        return marks.length > 1 ? marks.shift() : marks[0]
      }
      if (code.includes('c.settle(')) {
        p.calls.push('settle')
        return settles.length > 1 ? settles.shift() : settles[0]
      }
      if (code.includes('c.hide(')) {
        p.calls.push('hide')
        return { ok: null }
      }
      throw new Error(`test: unexpected code ${code.slice(0, 40)}`)
    },
    scrollTo: async (y: number): Promise<number> => (opts.scrollTo ?? (v => v))(y),
    sleep: async (): Promise<void> => {},
  }
  return p
}
const warnings = (): { list: string[]; warn: (m: string) => void } => {
  const list: string[] = []
  return { list, warn: m => list.push(m) }
}

describe('findStuckChrome', () => {
  it('installs once, scrolls twice, and returns what settle found', async () => {
    const p = page()
    const w = warnings()
    const deps: ProbeDeps = p
    expect(await findStuckChrome(deps, 768, w.warn)).toEqual([bar])
    expect(p.installs).toBe(1)
    expect(p.calls).toEqual(['mark', 'settle'])
    expect(w.list).toEqual([])
  })

  it('a page that cannot scroll to two offsets offers no evidence: nothing, no warning', async () => {
    const p = page({ scrollTo: () => 0 })
    const w = warnings()
    expect(await findStuckChrome(p, 768, w.warn)).toEqual([])
    expect(p.calls).toEqual(['mark'])
    expect(w.list).toEqual([])
  })

  it('reinstalls the controller once when the page replaced its document mid-probe, and measures again', async () => {
    const p = page({ settle: [{ missing: true }, { ok: [bar] }] })
    const w = warnings()
    expect(await findStuckChrome(p, 768, w.warn)).toEqual([bar])
    expect(p.installs).toBe(2)
    // The second measurement marks again: a mark from the old document means nothing to the new one.
    expect(p.calls).toEqual(['mark', 'settle', 'mark', 'settle'])
    expect(w.list.join(' ')).toMatch(/replaced its document during the probe; measured again/)
  })

  it('a controller gone twice is given up on, named as such', async () => {
    const p = page({ settle: [{ missing: true }] })
    const w = warnings()
    expect(await findStuckChrome(p, 768, w.warn)).toEqual([])
    expect(w.list.join(' ')).toMatch(/could not measure chrome stuck to the viewport/)
    expect(w.list.join(' ')).toMatch(/replaced its document twice/)
    expect(w.list.join(' ')).not.toMatch(/Script failed to execute/)
  })

  it("names the page's own error rather than Electron's line", async () => {
    const p = page({ settle: [{ error: 'Cannot read properties of null (reading getBoundingClientRect)' }] })
    const w = warnings()
    expect(await findStuckChrome(p, 768, w.warn)).toEqual([])
    expect(w.list.join(' ')).toMatch(/settle threw: Cannot read properties of null/)
  })
})

describe('callChrome', () => {
  it('hide and restore tolerate a controller the page has dropped', async () => {
    const p = page()
    let gone = true
    const exec = async (code: string): Promise<unknown> => {
      if (code === STUCK_CHROME_SCRIPT) {
        gone = false
        return p.exec(code)
      }
      if (gone) return { missing: true }
      return p.exec(code)
    }
    expect(await callChrome(exec, 'hide')).toEqual({ ok: null })
    expect(p.installs).toBe(1)
  })
})
