import { describe, expect, it } from 'vitest'
import { CONTROL_COMMANDS } from '../../src/shared/control'
import { validateFlow } from '../../src/shared/flow'

describe('validateFlow', () => {
  it('accepts a well-formed step list', () => {
    const result = validateFlow([
      { action: 'navigate', url: 'https://example.com' },
      { action: 'setPreset', id: 'laptop-768' },
      { action: 'click', target: '.checkout-button' },
    ])
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')
    expect(result.flow.steps).toEqual([
      { action: 'navigate', url: 'https://example.com' },
      { action: 'setPreset', id: 'laptop-768' },
      { action: 'click', target: '.checkout-button' },
    ])
  })

  it('accepts an empty step list', () => {
    const result = validateFlow([])
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')
    expect(result.flow.steps).toEqual([])
  })

  it('rejects a top-level value that is not an array, at index -1', () => {
    for (const bad of [{}, 'steps', 3, null, undefined, true]) {
      const result = validateFlow(bad)
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('expected rejection')
      expect(result.rejections).toEqual([{ index: -1, reason: expect.stringContaining('array') }])
    }
  })

  it('rejects a step that is not an object, naming what it actually got', () => {
    const result = validateFlow(['not an object', 3, null, ['nested', 'array']])
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected rejection')
    expect(result.rejections).toEqual([
      { index: 0, reason: expect.stringContaining('object') },
      { index: 1, reason: expect.stringContaining('object') },
      { index: 2, reason: expect.stringContaining('object') },
      { index: 3, reason: expect.stringContaining('object') },
    ])
  })

  it('rejects a step missing "action"', () => {
    const result = validateFlow([{ target: '.foo' }])
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected rejection')
    expect(result.rejections).toEqual([{ index: 0, reason: expect.stringMatching(/missing.*action/i) }])
  })

  it('rejects a step whose "action" is not a string', () => {
    const result = validateFlow([{ action: 7 }])
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected rejection')
    expect(result.rejections).toEqual([{ index: 0, reason: expect.stringMatching(/action.*string/i) }])
  })

  it('rejects an "action" outside the known control-command vocabulary, naming the valid ones', () => {
    const result = validateFlow([{ action: 'teleport' }])
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected rejection')
    expect(result.rejections).toHaveLength(1)
    expect(result.rejections[0]!.reason).toMatch(/teleport/)
    for (const c of CONTROL_COMMANDS) expect(result.rejections[0]!.reason).toContain(c)
  })

  it('rejects a step whose "target" is present but not a string', () => {
    const result = validateFlow([{ action: 'click', target: 42 }])
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected rejection')
    expect(result.rejections).toEqual([{ index: 0, reason: expect.stringMatching(/target.*string/i) }])
  })

  it('accepts a step with no "target" at all — it is optional', () => {
    const result = validateFlow([{ action: 'reload' }])
    expect(result.ok).toBe(true)
  })

  it('collects a rejection per bad step rather than stopping at the first', () => {
    const result = validateFlow([
      { action: 'navigate', url: 'https://example.com' },
      { action: 'teleport' },
      { target: '.foo' },
      { action: 'click', target: 5 },
    ])
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected rejection')
    expect(result.rejections.map(r => r.index)).toEqual([1, 2, 3])
  })

  it('validates a step whose passthrough data includes a "reason" field — the discriminator must not key off it', () => {
    const result = validateFlow([{ action: 'navigate', target: 'https://x.test', reason: 'verify the cart persists' }])
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')
    expect(result.flow.steps).toEqual([{ action: 'navigate', target: 'https://x.test', reason: 'verify the cart persists' }])
  })

  it('validates a step whose passthrough data includes an "index" field', () => {
    const result = validateFlow([{ action: 'navigate', index: 7 }])
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')
    expect(result.flow.steps).toEqual([{ action: 'navigate', index: 7 }])
  })

  it('carries arbitrary extra fields on a step through unvalidated', () => {
    const result = validateFlow([{ action: 'navigate', url: 'https://example.com', timeoutMs: 5000, note: 'first step' }])
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')
    expect(result.flow.steps[0]).toEqual({ action: 'navigate', url: 'https://example.com', timeoutMs: 5000, note: 'first step' })
  })

  it("validates a step carrying the discriminator's own keys — ok, step, rejection — as ordinary passthrough data", () => {
    // Guards the fix's actual invariant (nothing user-supplied can reach the
    // wrapper), not just the two historical symptoms that broke the old one.
    const result = validateFlow([{ action: 'navigate', ok: false, step: 'x', rejection: 'x' }])
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')
    expect(result.flow.steps[0]).toEqual({ action: 'navigate', ok: false, step: 'x', rejection: 'x' })
  })
})

describe('validateFlow: a step may state what it expects to see', () => {
  it('accepts observations as a list of non-blank strings, carried through verbatim', () => {
    const result = validateFlow([{ action: 'click', target: '.pay', observations: ['Order confirmed', ' Total: $12 '] }])
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')
    expect(result.flow.steps[0]!.observations).toEqual(['Order confirmed', ' Total: $12 '])
  })

  it('accepts an empty observations list, and a step with none', () => {
    expect(validateFlow([{ action: 'reload', observations: [] }]).ok).toBe(true)
    expect(validateFlow([{ action: 'reload' }]).ok).toBe(true)
  })

  it('rejects observations that is not an array, naming what it got', () => {
    for (const bad of ['Order confirmed', 7, {}, null, true]) {
      const result = validateFlow([{ action: 'reload', observations: bad }])
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('expected rejection')
      expect(result.rejections).toEqual([{ index: 0, reason: expect.stringMatching(/"observations" must be an array of strings, got/) }])
    }
  })

  it('rejects an entry that is not a string, naming its position inside the list', () => {
    const result = validateFlow([{ action: 'reload', observations: ['fine', 42, 'also fine'] }])
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected rejection')
    expect(result.rejections).toEqual([{ index: 0, reason: expect.stringMatching(/observations\[1\] must be a string, got number/) }])
  })

  it('rejects a blank entry — an empty string is "present" on every page, which says nothing', () => {
    for (const blank of ['', '   ', '\n\t']) {
      const result = validateFlow([{ action: 'reload', observations: ['ok', blank] }])
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('expected rejection')
      expect(result.rejections).toEqual([{ index: 0, reason: expect.stringMatching(/observations\[1\] is blank/) }])
    }
  })

  it('names the step, so a bad list in step 2 is not reported against step 0', () => {
    const result = validateFlow([{ action: 'reload' }, { action: 'reload' }, { action: 'reload', observations: [3] }])
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected rejection')
    expect(result.rejections.map(r => r.index)).toEqual([2])
  })
})

describe("validateFlow: the commands whose input the runner owns are not steps a flow states directly", () => {
  /**
   * **Table-driven on purpose, after a sabotage came back green.** Removing
   * `networkRecord` from the exclusion broke nothing: the code had the entry and
   * only `observeText` had a test, so the invariant was one command wide while
   * the set was two. A new entry now arrives with its coverage rather than
   * needing someone to remember a second edit.
   */
  const OWNED_BY_THE_RUNNER: Array<[action: string, extra: Record<string, unknown>]> = [
    ['observeText', { texts: ['Order confirmed'] }],
    ['networkRecord', {}],
  ]

  for (const [action, extra] of OWNED_BY_THE_RUNNER) {
    it(`rejects a hand-written ${action} step, naming why`, () => {
      const result = validateFlow([{ action, ...extra }])
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('expected rejection')
      expect(result.rejections).toEqual([
        { index: 0, reason: expect.stringMatching(new RegExp(`${action}.*runner issues it automatically`)) },
      ])
    })
  }

  it('still accepts status and captureRaster by hand — the runner also calls both automatically, but a QA engineer asking for one explicitly is meaningful and harmless to repeat', () => {
    expect(validateFlow([{ action: 'status' }]).ok).toBe(true)
    expect(validateFlow([{ action: 'captureRaster' }]).ok).toBe(true)
  })
})

describe('validateFlow: a type step must state its text, and text belongs to type alone', () => {
  it('accepts a type step with text, target, and no other fields', () => {
    const result = validateFlow([{ action: 'type', target: '#email', text: 'hello@example.com' }])
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')
    expect(result.flow.steps[0]).toEqual({ action: 'type', target: '#email', text: 'hello@example.com' })
  })

  it.each([
    ['missing entirely', {}],
    ['empty string', { text: '' }],
    ['not a string', { text: 42 }],
  ])('rejects a type step whose text is %s', (_name, extra) => {
    const result = validateFlow([{ action: 'type', target: '#email', ...extra }])
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected rejection')
    expect(result.rejections).toEqual([{ index: 0, reason: expect.stringMatching(/action is "type".*must state a non-empty "text"/) }])
  })

  it('rejects a type step with no target — there is no focused-element or point form', () => {
    const result = validateFlow([{ action: 'type', text: 'hello' }])
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected rejection')
    expect(result.rejections).toEqual([{ index: 0, reason: expect.stringMatching(/must name a "target" selector/) }])
  })

  it('rejects text on any action other than type, naming it as likely-stale rather than silently ignoring it', () => {
    const result = validateFlow([{ action: 'click', target: '#button', text: 'leftover from an edit' }])
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected rejection')
    expect(result.rejections).toEqual([{ index: 0, reason: expect.stringMatching(/states "text" but its action is "click", not "type"/) }])
  })

  it('accepts secret and append as booleans on a type step', () => {
    const result = validateFlow([{ action: 'type', target: '#otp', text: '123456', secret: true, append: false }])
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')
    expect(result.flow.steps[0]).toMatchObject({ secret: true, append: false })
  })

  it.each([
    ['secret', { secret: 'yes' }],
    ['append', { append: 'yes' }],
  ])('rejects a non-boolean %s', (field, extra) => {
    const result = validateFlow([{ action: 'type', target: '#x', text: 'x', ...extra }])
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected rejection')
    expect(result.rejections).toEqual([{ index: 0, reason: expect.stringMatching(new RegExp(`"${field}" must be a boolean`)) }])
  })
})
