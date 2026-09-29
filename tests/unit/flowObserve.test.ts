import { describe, expect, it } from 'vitest'
import { observeViaControl } from '../../src/mcp/flowObserve'

/**
 * `observeViaControl` is deliberately thin: every present/absent/unknown
 * decision belongs to `flowRunner.ts#recordObservations`, which is unit
 * tested against a fake `observe` directly (`tests/unit/flowRunner.test.ts`).
 * This file checks the one thing that lives here instead — turning the
 * control command's own untrusted reply into the three honest facts
 * `ObservationReading` carries, in the order asked.
 */

const goodReply = (overrides: Record<string, unknown> = {}) => ({
  ok: true,
  viewport: { width: 1280, height: 800 },
  findings: [
    { text: 'Order confirmed', renderedCount: 1, matches: [{ element: 'p#own', rect: { x: 0, y: 0, width: 10, height: 10 } }], unrenderedCount: 0, unrendered: [] },
    { text: 'Ghost text', renderedCount: 0, matches: [], unrenderedCount: 1, unrendered: [{ element: 'p#ghost', rect: { x: 0, y: 0, width: 0, height: 0 } }] },
  ],
  truncated: { matches: 0, unrendered: 0 },
  ...overrides,
})

describe('observeViaControl', () => {
  it('asks for exactly the stated texts, on the observeText command', async () => {
    let askedCommand: string | undefined
    let askedPayload: Record<string, unknown> | undefined
    const observe = observeViaControl(async (command, payload) => {
      askedCommand = command
      askedPayload = payload
      return goodReply()
    })
    await observe(['Order confirmed', 'Ghost text'])
    expect(askedCommand).toBe('observeText')
    expect(askedPayload).toEqual({ texts: ['Order confirmed', 'Ghost text'] })
  })

  it('reads a rendered match as found, with the matched elements in "saw"', async () => {
    const observe = observeViaControl(async () => goodReply())
    const [order] = await observe(['Order confirmed', 'Ghost text'])
    expect(order!.found).toBe(true)
    expect(order!.saw).toEqual(['p#own'])
  })

  it('reads zero rendered matches as not found, and carries no "saw"', async () => {
    const observe = observeViaControl(async () => goodReply())
    const [, ghost] = await observe(['Order confirmed', 'Ghost text'])
    expect(ghost!.found).toBe(false)
    expect(ghost!.saw).toBeUndefined()
  })

  it('is complete when the page reported no iframes — nothing structurally went unsearched', async () => {
    const observe = observeViaControl(async () => goodReply())
    const [, ghost] = await observe(['Order confirmed', 'Ghost text'])
    expect(ghost!.complete).toBe(true)
  })

  it('is NOT complete when the page has iframes in view, even for a text that found nothing rendered — an absence claim would not be honest', async () => {
    const observe = observeViaControl(async () => goodReply({ frames: { count: 1, viewportCoverage: 0.3 } }))
    const [, ghost] = await observe(['Order confirmed', 'Ghost text'])
    expect(ghost!.complete).toBe(false)
  })

  it('a present finding stays found regardless of iframes — a positive match is trustworthy either way', async () => {
    const observe = observeViaControl(async () => goodReply({ frames: { count: 1, viewportCoverage: 0.3 } }))
    const [order] = await observe(['Order confirmed', 'Ghost text'])
    expect(order!.found).toBe(true)
  })

  it('mentions unrendered matches in "looked" without ever counting them as found', async () => {
    const observe = observeViaControl(async () => goodReply())
    const [, ghost] = await observe(['Order confirmed', 'Ghost text'])
    expect(ghost!.found).toBe(false)
    expect(ghost!.looked).toMatch(/not rendered/)
  })

  it('answers in the same order the texts were asked in, even if the reply is scrambled', async () => {
    const observe = observeViaControl(async () =>
      goodReply({
        findings: [
          { text: 'Ghost text', renderedCount: 0, matches: [], unrenderedCount: 0, unrendered: [] },
          { text: 'Order confirmed', renderedCount: 1, matches: [], unrenderedCount: 0, unrendered: [] },
        ],
      }),
    )
    const [order, ghost] = await observe(['Order confirmed', 'Ghost text'])
    // The adapter reads positionally and checks the text lines up; a
    // scrambled reply is exactly the "did not answer for this text" case,
    // not silently paired with the wrong finding.
    expect(order!.found).toBe(false)
    expect(order!.complete).toBe(false)
    expect(order!.looked).toMatch(/did not answer/)
    expect(ghost).toBeDefined()
  })

  it('answers "did not answer for this text" rather than crashing when the reply has fewer findings than asked', async () => {
    const observe = observeViaControl(async () => goodReply({ findings: [goodReply().findings[0]] }))
    const [, second] = await observe(['Order confirmed', 'Something else'])
    expect(second!.found).toBe(false)
    expect(second!.complete).toBe(false)
  })

  it('rejects when the reply fails the untrusted-payload checks — left to the caller, never swallowed into a fake reading', async () => {
    const observe = observeViaControl(async () => ({ ok: true, findings: 'not an array' }))
    await expect(observe(['Order confirmed'])).rejects.toThrow()
  })

  it('rejects when the underlying call itself rejects (the control server\'s 409 for an unanswered page) — left to propagate, not caught here', async () => {
    const observe = observeViaControl(async () => {
      throw new Error('obsrv control observeText: the page did not answer the observeText within its budget')
    })
    await expect(observe(['Order confirmed'])).rejects.toThrow(/did not answer/)
  })
})
