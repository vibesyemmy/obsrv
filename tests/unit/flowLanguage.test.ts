import { describe, expect, it } from 'vitest'
import { isControlCommand, presetApplyError } from '../../src/shared/control'
import { validateFlow, type FlowStep } from '../../src/shared/flow'
import { resolveFlowText } from '../../src/shared/flowLanguage'
import { parseAuditRequest, parseInspectRequest, parseLintRequest, parseScrollRequest } from '../../src/shared/ipcPayloads'

/** Narrows to the ok arm and fails with the reasons, so a broken resolution reads
 *  as the rejection it produced rather than as `undefined is not an object`. */
function resolved(text: string) {
  const result = resolveFlowText(text)
  if (!result.ok) throw new Error(`expected "${text}" to resolve, got rejections: ${result.rejections.map(r => r.reason).join(' | ')}`)
  return result
}

function refused(text: string) {
  const result = resolveFlowText(text)
  if (result.ok) throw new Error(`expected "${text}" to be refused, got steps: ${JSON.stringify(result.flow.steps)}`)
  return result
}

/**
 * The payload the runner would send for a step. `runFlow` builds
 * `{target, ...rest}` (`src/mcp/flowRunner.ts`); the resolver emits no `target`
 * and no `observations`, which is asserted on its own below, so for its output
 * that reduces to every key but `action`.
 */
const payloadOf = ({ action, ...rest }: FlowStep): Record<string, unknown> => rest

describe('resolveFlowText', () => {
  it('resolves a multi-clause description into steps validateFlow accepts', () => {
    const result = resolved('go to example.com, audit, scroll down')
    expect(result.flow.steps).toEqual([{ action: 'navigate', url: 'example.com' }, { action: 'audit' }, { action: 'scroll', page: 'next' }])
    // The claim this module exists to make, checked against the validator
    // itself rather than against a reading of it.
    const revalidated = validateFlow(result.flow.steps)
    expect(revalidated.ok).toBe(true)
  })

  it('names the phrase each clause keyed off, clause by clause', () => {
    const { resolutions } = resolved('Go to example.com; then reload the page, and scroll to the bottom')
    // Scoped per resolution: a "somewhere in the output" check would pass on the
    // clause text alone, which repeats the engineer's own words and so proves
    // nothing about what the resolver read.
    expect(resolutions[0]).toEqual({ clause: 'Go to example.com', keyedOn: 'Go to' })
    expect(resolutions[1]).toEqual({ clause: 'reload the page', keyedOn: 'reload' })
    expect(resolutions[2]).toEqual({ clause: 'scroll to the bottom', keyedOn: 'scroll' })
  })

  it('returns one resolution per step, in step order', () => {
    const { flow, resolutions } = resolved('go to example.com, lint, back')
    expect(resolutions.length).toBe(flow.steps.length)
    expect(resolutions.map(r => r.clause)).toEqual(['go to example.com', 'lint', 'back'])
  })

  describe('the clause forms it resolves', () => {
    const cases: ReadonlyArray<readonly [string, FlowStep]> = [
      ['go to example.com', { action: 'navigate', url: 'example.com' }],
      ['open https://example.com/cart', { action: 'navigate', url: 'https://example.com/cart' }],
      ['visit localhost:5173', { action: 'navigate', url: 'localhost:5173' }],
      ['load /tmp/page.html', { action: 'navigate', url: '/tmp/page.html' }],
      ['go back', { action: 'back' }],
      ['forward', { action: 'forward' }],
      ['reload', { action: 'reload' }],
      ['refresh the page', { action: 'reload' }],
      ['scroll down', { action: 'scroll', page: 'next' }],
      ['scroll up', { action: 'scroll', page: 'prev' }],
      ['scroll to the top', { action: 'scroll', page: 'top' }],
      ['scroll to bottom', { action: 'scroll', page: 'bottom' }],
      ['audit', { action: 'audit' }],
      ['run an audit', { action: 'audit' }],
      ['lint the page', { action: 'lint' }],
      ['take a screenshot', { action: 'captureVisible' }],
      ['inspect .cart-total', { action: 'inspect', selector: '.cart-total' }],
      ['inspect #checkout .total', { action: 'inspect', selector: '#checkout .total' }],
      ['inspect button', { action: 'inspect', selector: 'button' }],
      ['on laptop-768', { action: 'setPreset', id: 'laptop-768' }],
      ['switch to the iphone-se preset', { action: 'setPreset', id: 'iphone-se' }],
    ]

    for (const [text, step] of cases) {
      it(`resolves "${text}" into ${JSON.stringify(step)}`, () => {
        expect(resolved(text).flow.steps).toEqual([step])
      })
    }

    it('emits only real control commands', () => {
      for (const [text] of cases) {
        const step = resolved(text).flow.steps[0]!
        expect(isControlCommand(step.action), `${text} → ${step.action}`).toBe(true)
      }
    })

    it('emits no "target" and no "observations" on any step', () => {
      for (const [text] of cases) {
        const step = resolved(text).flow.steps[0]!
        // No control payload parser reads a key named `target` — `navigate`
        // wants `url`, `inspect` wants `selector`, `setPreset` wants `id`. A
        // step carrying `target` validates and then fails live, which is the
        // trap `{action: 'click', target: '.checkout-button'}` in flow.test.ts
        // sits in. `observations` belongs to `feat-flow-observations`, which
        // owns how an expectation is stated; this resolver invents none.
        expect(Object.keys(step), text).not.toContain('target')
        expect(Object.keys(step), text).not.toContain('observations')
      }
    })
  })

  describe('the payloads it emits are ones the live parsers accept', () => {
    // The resolver's own output fed to the parsers the control server runs on
    // it, so a payload key that only looks right is caught here rather than as
    // a 400 mid-flow. Per action, not "some parser somewhere accepted it".
    it('scroll', () => {
      // The parsed request, not just "not an error string": `parseScrollRequest`
      // returns the error as a string, so a loose check passes on any object and
      // would not notice a page word the scroller does not know.
      const parsed = (text: string) => parseScrollRequest(payloadOf(resolved(text).flow.steps[0]!))
      expect(parsed('scroll down')).toEqual({ x: 0, y: 0, page: 'next' })
      expect(parsed('scroll up')).toEqual({ x: 0, y: 0, page: 'prev' })
      expect(parsed('scroll to the top')).toEqual({ x: 0, y: 0, page: 'top' })
      expect(parsed('scroll to the bottom')).toEqual({ x: 0, y: 0, page: 'bottom' })
    })

    it('audit and lint carry no payload at all, which their parsers accept as the defaults', () => {
      // `parseAuditRequest` and `parseLintRequest` ignore keys they do not know,
      // so asking them alone would accept any object. The claim that carries the
      // weight is that the step has nothing but its action.
      const audit = payloadOf(resolved('audit').flow.steps[0]!)
      const lint = payloadOf(resolved('lint').flow.steps[0]!)
      expect(audit).toEqual({})
      expect(lint).toEqual({})
      expect(parseAuditRequest(audit)).toEqual({})
      expect(parseLintRequest(lint)).toEqual({})
    })

    it('inspect', () => {
      expect(parseInspectRequest(payloadOf(resolved('inspect .cart-total').flow.steps[0]!))).toEqual({ selector: '.cart-total' })
    })

    it('setPreset', () => {
      expect(presetApplyError(payloadOf(resolved('on laptop-768').flow.steps[0]!)['id'])).toBeNull()
    })
  })

  describe('clause splitting', () => {
    it('splits on commas, semicolons, newlines, "and" and "then"', () => {
      const { resolutions } = resolved('audit; lint\nback, forward and reload then scroll down')
      expect(resolutions.map(r => r.clause)).toEqual(['audit', 'lint', 'back', 'forward', 'reload', 'scroll down'])
    })

    it('does not split a URL path containing "and" or "then"', () => {
      // The guard this pattern is bought by: a `\band\b` separator splits
      // `example.com/and/more` into a URL and a stray clause, so the separator
      // requires literal surrounding whitespace, which no URL contains.
      expect(resolved('go to example.com/and/more').flow.steps).toEqual([{ action: 'navigate', url: 'example.com/and/more' }])
      expect(resolved('go to example.com/then/next').flow.steps).toEqual([{ action: 'navigate', url: 'example.com/then/next' }])
    })

    it('drops blank clauses rather than rejecting them', () => {
      expect(resolved('audit,, lint,').flow.steps).toEqual([{ action: 'audit' }, { action: 'lint' }])
    })

    it('collapses whitespace and trims sentence-final punctuation', () => {
      expect(resolved('  reload   the  page. ').flow.steps).toEqual([{ action: 'reload' }])
    })
  })

  describe('refusals', () => {
    it('refuses an interaction stated by description, naming click coordinates, one rejection per clause', () => {
      const { rejections } = refused('log in, add an item, checkout')
      expect(rejections.map(r => ({ index: r.index, clause: r.clause }))).toEqual([
        { index: 0, clause: 'log in' },
        { index: 1, clause: 'add an item' },
        { index: 2, clause: 'checkout' },
      ])
      // Each reason names the mechanism, not just the verdict — asserted on
      // every rejection, since one matching reason would leave the other two
      // free to say nothing.
      for (const rejection of rejections) {
        expect(rejection.reason, rejection.clause).toMatch(/CSS-viewport coordinates/)
        expect(rejection.reason, rejection.clause).toMatch(/\{x, y\}/)
      }
    })

    it('refuses a click or type clause for the same reason', () => {
      for (const text of ['click the checkout button', 'type my email', 'press submit', 'select the large size']) {
        expect(refused(text).rejections[0]!.reason, text).toMatch(/CSS-viewport coordinates/)
      }
    })

    it('refuses a blank description at index -1 instead of resolving an empty flow', () => {
      for (const blank of ['', '   ', ',,', '\n']) {
        const { rejections } = refused(blank)
        expect(rejections).toEqual([{ index: -1, clause: blank, reason: expect.stringContaining('at least one clause') }])
      }
    })

    it('refuses an unrecognised clause by listing the forms it does resolve', () => {
      const reason = refused('make the page nicer').rejections[0]!.reason
      expect(reason).toContain('go to <url>')
      expect(reason).toContain('inspect <css selector>')
    })

    it('refuses a bare word as a navigation target rather than normalising it to a host', () => {
      // "go to sleep" would otherwise become https://sleep — a navigation
      // nobody asked for, wearing the shape of one they did.
      expect(refused('go to sleep').rejections[0]!.reason).toMatch(/not a URL/)
    })

    it('refuses a URL scheme with the shared allowlist message', () => {
      expect(refused('go to javascript:alert(1)').rejections[0]!.reason).toMatch(/unsupported URL scheme/)
    })

    it('refuses an unknown preset id with presetApplyError naming the valid ids', () => {
      const reason = refused('on mobile').rejections[0]!.reason
      expect(reason).toMatch(/unknown preset "mobile"/)
      expect(reason).toContain('laptop-768')
    })

    it('refuses the custom preset, which cannot be applied remotely', () => {
      expect(refused('on custom').rejections[0]!.reason).toMatch(/custom preset cannot be applied remotely/)
    })

    it('refuses a described element where inspect needs a selector', () => {
      expect(refused('inspect the login button').rejections[0]!.reason).toMatch(/description, not a CSS selector/)
    })

    it('refuses a directionless scroll instead of picking a direction', () => {
      expect(refused('scroll').rejections[0]!.reason).toMatch(/needs a direction/)
    })

    it('reports every bad clause, not just the first, with the good ones absent', () => {
      const { rejections } = refused('go to example.com, log in, scroll, audit')
      expect(rejections.map(r => r.clause)).toEqual(['log in', 'scroll'])
      expect(rejections.map(r => r.index)).toEqual([1, 2])
    })

    it('names the clause inside the reason as well as beside it', () => {
      // A reason read on its own — in a log line, a report row — has to say
      // which clause it is about; the repo's rule that a sentence names its own
      // subject rather than keying off its neighbours.
      const rejection = refused('go to example.com, log in').rejections[0]!
      expect(rejection.reason).toContain('clause 1 ("log in")')
    })
  })
})
