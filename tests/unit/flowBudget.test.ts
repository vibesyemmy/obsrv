import { describe, expect, it } from 'vitest'
import { budgetKindFor, budgetKinds } from '../../src/mcp/flowBudget'
import { CONTROL_COMMANDS } from '../../src/shared/control'

/**
 * A flow binds one control call for the whole held session, which made it easy
 * to bind one budget too. That shipped in review: every command got the 5 s
 * apply budget, including the per-step settle probe — a raster capture the
 * dedicated path allows 30 s. The probe would have timed out on every step of
 * every flow, been caught, said nothing, and rendered every step `unknown`:
 * the feature's own third state firing always, for a reason that reads as the
 * page misbehaving rather than as a budget.
 *
 * So these tests are about one thing: no command silently gets the shortest
 * budget.
 */
describe('a flow step’s budget', () => {
  it('gives the settle probe the capture budget, not the apply budget', () => {
    // The one that was actually broken.
    expect(budgetKindFor('captureRaster')).toBe('capture')
  })

  it('gives every capture the capture budget', () => {
    for (const c of ['captureVisible', 'captureTarget', 'captureRaster']) expect(budgetKindFor(c)).toBe('capture')
  })

  it('gives the page-wide measurements their own budget, not the apply one', () => {
    expect(budgetKindFor('audit')).toBe('measure')
    expect(budgetKindFor('lint')).toBe('measure')
  })

  it('gives anything that loads a page the navigation budget', () => {
    for (const c of ['navigate', 'reload', 'back', 'forward']) expect(budgetKindFor(c)).toBe('navigate')
  })

  it('leaves a click, a scroll and a preset on the apply budget, which is what it is for', () => {
    for (const c of ['click', 'scroll', 'setPreset', 'activateTab']) expect(budgetKindFor(c)).toBe('apply')
  })

  it('answers for every control command, so a step can never be unbudgeted', () => {
    const kinds = budgetKinds()
    expect(kinds).toHaveLength(CONTROL_COMMANDS.length)
    for (const { command, kind } of kinds) expect(kind, `${command} has no budget kind`).toBeTruthy()
  })

  it('does not put a slow command on the apply budget by omission', () => {
    // The guard with teeth: any command whose NAME says it captures or measures
    // must not be an apply. A new `captureFoo` added to the protocol and not to
    // this module fails here rather than timing out in a flow six weeks later.
    const slow = CONTROL_COMMANDS.filter(c => /^capture/.test(c) || c === 'audit' || c === 'lint')
    expect(slow.length).toBeGreaterThan(0)
    for (const c of slow) expect(budgetKindFor(c), `${c} looks slow but is budgeted as an apply`).not.toBe('apply')
  })
})
