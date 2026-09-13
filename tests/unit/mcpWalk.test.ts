import { describe, expect, it, vi } from 'vitest'
import { ControlCallError } from '../../src/mcp/control'
import { WALK_BUDGET_MS, WALK_DWELL_MS, WALK_OLDER_APP_NOTE, walkPage, type WalkDeps } from '../../src/mcp/walk'
import { WALK_NOTHING_NOTE } from '../../src/shared/walkCoverage'

/**
 * The walk over an injected control call. `answers` is what each successive
 * `scroll { page: "next" }` returns; `top` scrolls always succeed unless the
 * test says otherwise. The clock advances only through `sleep`.
 */
function deps(
  answers: Array<Record<string, unknown> | Error>,
  opts: { top?: Error } = {},
): WalkDeps & { commands: Array<{ command: string; payload: Record<string, unknown> }>; slept: number[]; clock: number } {
  const d = {
    commands: [] as Array<{ command: string; payload: Record<string, unknown> }>,
    slept: [] as number[],
    clock: 0,
    call: vi.fn(async (command: string, payload: Record<string, unknown>) => {
      d.commands.push({ command, payload })
      if (payload['page'] === 'top') {
        if (opts.top) throw opts.top
        return { ok: true, scrolled: { x: 0, y: 0 }, scroller: 'root', atEnd: false }
      }
      const next = answers.shift()
      if (next === undefined) throw new Error('test: more scrolls than answers')
      if (next instanceof Error) throw next
      return next
    }),
    sleep: vi.fn(async (ms: number) => {
      d.slept.push(ms)
      d.clock += ms
    }),
    now: () => d.clock,
  }
  return d
}

const step = (y: number, atEnd = false) => ({ ok: true, scrolled: { x: 0, y }, scroller: 'root', atEnd })
const arrived = (y: number, count: number, atEnd = false) => ({ ...step(y, atEnd), arrival: { count, url: `https://a.test/?n=${count}` } })

const older = () => new ControlCallError('obsrv control scroll: scroll payload must be { x, y } with finite, non-negative CSS-pixel offsets', 400)

describe('walkPage', () => {
  it('walks to the end a screenful at a time, dwells on each, and returns to the top', async () => {
    const d = deps([step(768), step(1536), step(2000, true)])
    const r = await walkPage(d)
    // `documentLocked` is what the coverage note reads to tell a page that
    // grew from one a modal held: false here, an ordinary page that scrolled.
    expect(r).toEqual({ walked: { screenfuls: 3, atEnd: true, ms: 3 * WALK_DWELL_MS }, notes: [], documentLocked: false })
    expect(d.commands.map(c => c.payload['page'])).toEqual(['top', 'next', 'next', 'next', 'top'])
    expect(d.commands.every(c => c.command === 'scroll')).toBe(true)
    expect(d.slept).toEqual([WALK_DWELL_MS, WALK_DWELL_MS, WALK_DWELL_MS])
  })

  it('has no screenful cap: forty screenfuls inside the budget walk to the end', async () => {
    // The cap was the band capture's, where each screenful is a render; a
    // walk costs a dwell. bbc.com on a phone is twenty-two screenfuls, and
    // everything past a cap of twelve was measured as it first shipped —
    // lazy placeholders as "upscaled" images, the 0.42.0 finding again.
    const d = deps([...Array.from({ length: 39 }, (_, i) => step((i + 1) * 768)), step(40 * 768, true)])
    const r = await walkPage(d)
    expect(r.walked).toEqual({ screenfuls: 40, atEnd: true, ms: 40 * WALK_DWELL_MS })
    expect(r.notes).toEqual([])
    expect(d.commands.filter(c => c.payload['page'] === 'next')).toHaveLength(40)
    expect(d.commands.at(-1)?.payload['page']).toBe('top')
  })

  it('a page with nothing to scroll: the first next lands where the page already was and the app says atEnd — zero screenfuls, at the end, no dwell', async () => {
    const d = deps([step(0, true)])
    const r = await walkPage(d)
    expect(r).toEqual({ walked: { screenfuls: 0, atEnd: true, ms: 0 }, notes: [], documentLocked: false })
    expect(d.commands.map(c => c.payload['page'])).toEqual(['top', 'next', 'top'])
    expect(d.slept).toEqual([])
  })

  it('a page that will not move and is not at its end: atEnd false, and a note', async () => {
    const d = deps([step(0)])
    const r = await walkPage(d)
    expect(r.walked).toEqual({ screenfuls: 0, atEnd: false, ms: 0 })
    expect(r.notes.join(' ')).toMatch(/stopped moving/)
    expect(d.commands.map(c => c.payload['page'])).toEqual(['top', 'next', 'top'])
    expect(d.slept).toEqual([])
  })

  it('an unconfirmed scroll (scrolled: null) is the end: stop, note, return to the top', async () => {
    const d = deps([step(768), { ok: true, scrolled: null, warnings: ['scroll offset could not be confirmed'] }, step(3000)])
    const r = await walkPage(d)
    expect(r.walked).toEqual({ screenfuls: 1, atEnd: false, ms: WALK_DWELL_MS })
    expect(r.notes.join(' ')).toMatch(/did not confirm/)
    expect(d.commands.map(c => c.payload['page'])).toEqual(['top', 'next', 'next', 'top'])
  })

  it('an app that predates page-wise scrolling: no walk, the note, nothing else asked of it', async () => {
    const d = deps([], { top: older() })
    const r = await walkPage(d)
    expect(r).toEqual({ notes: [WALK_OLDER_APP_NOTE] })
    expect(d.commands).toHaveLength(1)
    expect(d.slept).toEqual([])
  })

  it('any other failure mid-walk is a note, not an error, reports the partial walk, and the page is still sent back to the top', async () => {
    const d = deps([step(768), new Error('socket hang up')])
    const r = await walkPage(d)
    expect(r.walked).toEqual({ screenfuls: 1, atEnd: false, ms: WALK_DWELL_MS })
    expect(r.notes.join(' ')).toMatch(/cut short.*socket hang up.*partial walk/)
    expect(d.commands.at(-1)?.payload['page']).toBe('top')
  })

  it('stops at its time budget, says so, and still returns to the top', async () => {
    const d = deps(Array.from({ length: 40 }, (_, i) => step((i + 1) * 768)))
    d.sleep = vi.fn(async () => {
      d.clock += 6_000
    })
    const r = await walkPage(d)
    expect(r.walked).toEqual({ screenfuls: 3, atEnd: false, ms: 18_000 })
    expect(r.notes.join(' ')).toMatch(/15 s budget/)
    expect(d.commands.at(-1)?.payload['page']).toBe('top')
    expect(r.walked!.ms).toBeGreaterThanOrEqual(WALK_BUDGET_MS)
  })

  it('a failure on the final return to the top is swallowed: the measurement must still happen', async () => {
    const d = deps([step(768, true)])
    let tops = 0
    const call = d.call
    d.call = vi.fn(async (command: string, payload: Record<string, unknown>) => {
      if (payload['page'] === 'top' && ++tops === 2) throw new Error('gone')
      return call(command, payload)
    })
    const r = await walkPage(d)
    expect(r.walked).toEqual({ screenfuls: 1, atEnd: true, ms: WALK_DWELL_MS })
    expect(r.notes.join(' ')).toMatch(/return to the top/)
  })
})

/**
 * On an app shell that hides the document's overflow with no scroller the app
 * can find, the first `next` lands where the page already was — the walk is
 * right to stop — and the answer must say so, as the full-page capture does;
 * before this it read `walked: { screenfuls: 0, atEnd: true }`, a one-screen
 * page (spotify.com's web player on desktop, 2026-09-11).
 */
describe('walkPage on a page with nothing to scroll', () => {
  const deps = (reply: Record<string, unknown>) => {
    let now = 0
    return {
      call: async (_cmd: string, _args: Record<string, unknown>) => reply,
      sleep: async (ms: number) => void (now += ms),
      now: () => now,
    }
  }
  it('says the document hides its overflow and nothing scrolls, when the app says so', async () => {
    const w = await walkPage(deps({ scrolled: { x: 0, y: 0 }, atEnd: true, scroller: 'root', hidden: true }))
    expect(w.walked).toMatchObject({ screenfuls: 0, atEnd: true })
    expect(w.notes).toContain(WALK_NOTHING_NOTE)
  })
  it('says nothing extra for an ordinary one-screen page', async () => {
    const w = await walkPage(deps({ scrolled: { x: 0, y: 0 }, atEnd: true, scroller: 'root', hidden: false }))
    expect(w.walked).toMatchObject({ screenfuls: 0, atEnd: true })
    expect(w.notes).toEqual([])
  })
  it('says nothing extra when an older app does not report it', async () => {
    const w = await walkPage(deps({ scrolled: { x: 0, y: 0 }, atEnd: true, scroller: 'root' }))
    expect(w.notes).toEqual([])
  })
})

/**
 * A page that replaces itself under the walk — HMR, an auth redirect, a
 * router — resets the scroll to the top, and the walk kept counting. Driving
 * the live app at a page that moved 1.2 s in returned `screenfuls: 10` for a
 * 6.8-screenful page: the count spanned two documents and `atEnd` vouched for
 * the end of a page that was gone (measured 2026-09-13). The arrivals count
 * from main (ipc.ts) is echoed on each scroll reply, so the walk knows a
 * commit happened rather than inferring one from a scroll going backwards.
 */
describe('a page replaced under the walk', () => {
  it('counts screenfuls of the page it ended on, not of both', async () => {
    // Two screenfuls of the first document, then the commit, then three of the
    // second — which is a three-screenful page, and what the answer should say.
    const d = deps([
      arrived(768, 1),
      arrived(1536, 1),
      arrived(768, 2),
      arrived(1536, 2),
      arrived(2000, 2, true),
    ])
    const r = await walkPage(d)
    expect(r.walked).toEqual({ screenfuls: 3, atEnd: true, ms: 5 * WALK_DWELL_MS })
  })

  it('does not read the new page\'s first offset as a page that would not move', async () => {
    // The second document starts at the top, so its first `next` can land
    // below where the first document had reached — or at the same offset. The
    // same-offset case must not read as "the page stopped moving".
    const d = deps([arrived(768, 1), arrived(768, 2), arrived(1536, 2, true)])
    const r = await walkPage(d)
    expect(r.walked).toEqual({ screenfuls: 2, atEnd: true, ms: 3 * WALK_DWELL_MS })
    expect(r.notes).toEqual([])
  })

  it('an app that sends no arrivals keeps today\'s behaviour and says nothing new', async () => {
    const d = deps([step(768), step(1536), step(2000, true)])
    const r = await walkPage(d)
    expect(r.walked).toEqual({ screenfuls: 3, atEnd: true, ms: 3 * WALK_DWELL_MS })
    expect(r.notes).toEqual([])
  })
})
