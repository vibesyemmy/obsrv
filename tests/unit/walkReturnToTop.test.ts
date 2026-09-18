import { describe, expect, it } from 'vitest'
import { walkHeadless } from '../../src/cli/walk'

/**
 * What the headless walk says when it could not return the page to the top
 * (`bug-walk-return-note-names-budget`).
 *
 * `backToTop` runs after the loop, when the walk's deadline has usually just
 * run out, so `withinBudget` gives the page ~0 ms and the note then said *"the
 * page did not answer a scroll within 15 s (its main thread was busy or
 * blocked); measured where it stopped"*. Three things were wrong with one
 * sentence: the duration (a wait that never happened), the accusation (a page
 * that answered every step), and the place (the scroll lands anyway, so the
 * page is at the top).
 *
 * A fake target rather than Electron: the whole defect is a race between
 * `withinBudget`'s timer and a reply, so the reply's latency is the variable,
 * and on a real target it is whatever the machine does that second. The fake
 * applies each scroll **when the script runs**, awaited or not, which is what a
 * renderer does with an abandoned `executeJavaScript`.
 */

interface FakePage {
  /** Where the page ended up, after every script has run. */
  y: number
  /** Every step the page actually performed, in order. */
  applied: string[]
}

/**
 * A page that answers every step after `latencyMs`, and keeps answering after
 * nobody is waiting. `endAfter` is how many screenfuls it has: reached, the
 * walk ends on the page rather than on its budget.
 */
const answeringTarget = (latencyMs: number, page: FakePage, endAfter = Infinity) => ({
  on() {},
  off() {},
  webContents: {
    executeJavaScript: (code: string) => {
      const which = code.endsWith('("top")') ? 'top' : code.endsWith('("next")') ? 'next' : 'other'
      const run = (): unknown => {
        if (which === 'top') page.y = 0
        else if (which === 'next') page.y += 768
        page.applied.push(which)
        const steps = page.applied.filter(a => a === 'next').length
        return which === 'other' ? 0 : { y: page.y, atEnd: steps >= endAfter, scroller: 'root', hidden: false, pageHeight: 1e9 }
      }
      return new Promise(resolve => setTimeout(() => resolve(run()), latencyMs))
    },
  },
})

/** A page that answers the first step and then holds its thread: the cut-short path. */
const blockingTarget = (page: FakePage) => {
  let answered = 0
  return {
    on() {},
    off() {},
    webContents: {
      executeJavaScript: (code: string) => {
        const which = code.endsWith('("top")') ? 'top' : code.endsWith('("next")') ? 'next' : 'other'
        if (which === 'next' && answered >= 1) return new Promise(() => {})
        if (which === 'next') answered++
        const run = (): unknown => {
          if (which === 'top') page.y = 0
          else if (which === 'next') page.y += 768
          page.applied.push(which)
          return which === 'other' ? 0 : { y: page.y, atEnd: false, scroller: 'root', hidden: false, pageHeight: 1e9 }
        }
        return new Promise(resolve => setTimeout(() => resolve(run()), 1))
      },
    },
  }
}

const noteAbout = (notes: string[] | undefined, phrase: string): string | undefined => (notes ?? []).find(n => n.includes(phrase))

const BUDGET_MS = 600

describe('the walk’s return to the top, when its own budget is already spent', () => {
  it('does not blame the page’s main thread for a wait it never made', async () => {
    const page: FakePage = { y: 0, applied: [] }
    const out = await walkHeadless(answeringTarget(5, page) as never, BUDGET_MS)
    const note = noteAbout(out.notes, 'return to the top')
    expect(note, `no return-to-top note at all: ${JSON.stringify(out.notes)}`).toBeTruthy()
    // The page answered every step it was given. Saying its main thread was
    // busy is the accusation this card is about.
    expect(note).not.toContain('main thread was busy or blocked')
    // And the number: it names no wait, because there was none to name.
    expect(note).not.toMatch(/within [\d.]+ s/)
    expect(note).toContain('no budget left')
  })

  it('does not claim the measurement is of where the walk stopped, because the scroll lands anyway', async () => {
    const page: FakePage = { y: 0, applied: [] }
    const out = await walkHeadless(answeringTarget(5, page) as never, BUDGET_MS)
    // The abandoned script still runs: this is the assumption the fake makes,
    // and the reason the old last clause was false.
    await new Promise(r => setTimeout(r, 60))
    expect(page.applied[page.applied.length - 1], 'the fake never ran the abandoned top scroll').toBe('top')
    expect(page.y, 'the page did not end at the top, so this arm tests nothing').toBe(0)
    expect(noteAbout(out.notes, 'return to the top')).not.toContain('measured where it stopped')
  })

  it('says it anyway rather than going quiet, so a walk that did return reads differently', async () => {
    const page: FakePage = { y: 0, applied: [] }
    const spent = await walkHeadless(answeringTarget(5, page) as never, BUDGET_MS)
    expect(noteAbout(spent.notes, 'return to the top')).toBeTruthy()
    // A walk with budget to spare reaches the end of a short page, returns to
    // the top, and says nothing about it.
    const roomy: FakePage = { y: 0, applied: [] }
    const ok = await walkHeadless(answeringTarget(1, roomy, 3) as never, 30_000)
    expect(noteAbout(ok.notes, 'return to the top'), JSON.stringify(ok.notes)).toBeUndefined()
  })

  it('is the same across the latency range, since which side wins the race is not the point', async () => {
    const seen: string[] = []
    for (const latency of [2, 3, 5, 8, 12, 20]) {
      const page: FakePage = { y: 0, applied: [] }
      const out = await walkHeadless(answeringTarget(latency, page) as never, BUDGET_MS)
      const note = noteAbout(out.notes, 'return to the top')
      seen.push(`${latency}:${note === undefined ? 'silent' : 'said'}`)
    }
    // Every arm in this range reached the note before the fix; none of them may
    // reach a false one after it.
    expect(seen.join(' ')).toBe('2:said 3:said 5:said 8:said 12:said 20:said')
  })
})

describe('the walk cut short by a page that stopped answering', () => {
  it('names the time the step was actually given, not the whole budget', async () => {
    const page: FakePage = { y: 0, applied: [] }
    const out = await walkHeadless(blockingTarget(page) as never, BUDGET_MS)
    const cut = noteAbout(out.notes, 'cut short')
    expect(cut, `no cut-short note: ${JSON.stringify(out.notes)}`).toBeTruthy()
    // The step began after the walk had already spent time on its first
    // screenful and its dwell, so the wait it made is shorter than the budget.
    const said = /within ([\d.]+) s/.exec(cut!)
    expect(said, `the cut-short note names no duration: ${cut}`).not.toBeNull()
    const seconds = Number(said![1])
    expect(seconds, cut).toBeLessThan(BUDGET_MS / 1000)
    expect(seconds, cut).toBeGreaterThan(0)
    // Here the accusation is fair: the page really did stop answering.
    expect(cut).toContain('main thread was busy or blocked')
  })
})
