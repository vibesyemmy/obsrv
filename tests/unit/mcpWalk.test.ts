import { describe, expect, it, vi } from 'vitest'
import { ControlCallError } from '../../src/mcp/control'
import { WALK_DWELL_MS, WALK_MAX_SCREENFULS, WALK_OLDER_APP_NOTE, walkPage, type WalkDeps } from '../../src/mcp/walk'

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
const older = () => new ControlCallError('obsrv control scroll: scroll payload must be { x, y } with finite, non-negative CSS-pixel offsets', 400)

describe('walkPage', () => {
  it('walks to the end a screenful at a time, dwells on each, and returns to the top', async () => {
    const d = deps([step(768), step(1536), step(2000, true)])
    const r = await walkPage(d)
    expect(r).toEqual({ walked: { screenfuls: 3, atEnd: true, ms: 3 * WALK_DWELL_MS }, notes: [] })
    expect(d.commands.map(c => c.payload['page'])).toEqual(['top', 'next', 'next', 'next', 'top'])
    expect(d.commands.every(c => c.command === 'scroll')).toBe(true)
    expect(d.slept).toEqual([WALK_DWELL_MS, WALK_DWELL_MS, WALK_DWELL_MS])
  })

  it('stops at the cap and says so; atEnd is false', async () => {
    const d = deps(Array.from({ length: WALK_MAX_SCREENFULS + 5 }, (_, i) => step((i + 1) * 768)))
    const r = await walkPage(d)
    expect(r.walked).toEqual({ screenfuls: WALK_MAX_SCREENFULS, atEnd: false, ms: WALK_MAX_SCREENFULS * WALK_DWELL_MS })
    expect(r.notes.join(' ')).toContain(`${WALK_MAX_SCREENFULS} screenfuls`)
    expect(d.commands.filter(c => c.payload['page'] === 'next')).toHaveLength(WALK_MAX_SCREENFULS)
    expect(d.commands.at(-1)?.payload['page']).toBe('top')
  })

  it('a page with nothing to scroll: the first next lands where the page already was — zero screenfuls, at the end, no dwell', async () => {
    const d = deps([step(0), step(0), step(0)])
    const r = await walkPage(d)
    expect(r).toEqual({ walked: { screenfuls: 0, atEnd: true, ms: 0 }, notes: [] })
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

  it('any other failure mid-walk is a note, not an error, and the page is still sent back to the top', async () => {
    const d = deps([step(768), new Error('socket hang up')])
    const r = await walkPage(d)
    expect(r.walked).toBeUndefined()
    expect(r.notes.join(' ')).toMatch(/cut short.*socket hang up/)
    expect(d.commands.at(-1)?.payload['page']).toBe('top')
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
