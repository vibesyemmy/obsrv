import { describe, expect, it } from 'vitest'
import type { Flow } from '../../src/shared/flow'
import { runFlow } from '../../src/mcp/flowRunner'

function flow(steps: Flow['steps']): Flow {
  return { steps }
}

/**
 * `bug-selector-click-over-scrolls-under-text-scale`, end to end through the runner against a page that
 * obeys the physics measured on the app (probe, 2026-10-03): an element at page position P, scrolled to S
 * page px, under text scale k reads `rect.y = (P - S) * k` in surface px; `scroll` takes page px; the
 * viewport the runner checks against is the surface's.
 */
describe('runFlow: a click on an element below the fold, under a text scale', () => {
  const SURFACE = { cssWidth: 393, cssHeight: 852 }
  const P = 2216
  const PAGE_HEIGHT = 4357
  const SIZE = { width: 360, height: 56 }

  /** `k` is the scale the page really runs at; `reported` is what `status` says it is (the same, unless a test lies). */
  const run = async (k: number | undefined, reported: unknown = k) => {
    let scroll = 0
    let recorded = 0 // what the app last landed a scroll at, which `pageRect` adds to `rect`
    const scale = k ?? 1
    const scrolls: Array<Record<string, unknown>> = []
    const presses: Array<{ x: number; y: number }> = []
    const box = () => ({ x: 30, y: (P - scroll) * scale, ...SIZE })
    const result = await runFlow(flow([{ action: 'click', target: '#below-cta' }]), {
      call: async (command, payload = {}) => {
        if (command === 'captureRaster') return { settled: true }
        if (command === 'status') return { ...SURFACE, ...(reported !== undefined ? { textScale: reported } : {}) }
        if (command === 'scroll') {
          scrolls.push(payload)
          // Page px, clamped to the document, and the app records where it landed.
          scroll = Math.max(0, Math.min(payload['y'] as number, PAGE_HEIGHT - SURFACE.cssHeight / scale))
          recorded = scroll
          return { ok: true, scrolled: { x: 0, y: scroll } }
        }
        if (command === 'click') {
          presses.push({ x: payload['x'] as number, y: payload['y'] as number })
          return { ok: true }
        }
        if (command === 'inspect') {
          const b = box()
          const pageRect = { ...b, y: b.y + recorded }
          if (payload['x'] !== undefined) {
            const hit = payload['x'] as number >= b.x && (payload['x'] as number) < b.x + b.width && (payload['y'] as number) >= b.y && (payload['y'] as number) < b.y + b.height
            return hit ? { ok: true, found: true, readout: { rect: b, pageRect, element: 'button' } } : { ok: true, found: true, readout: { rect: { x: 0, y: 0, width: 393, height: 852 }, pageRect, element: 'body' } }
          }
          return { ok: true, found: true, readout: { rect: b, pageRect, element: 'button' } }
        }
        return { ok: true }
      },
    })
    return { result, scrolls, presses, finalBox: box(), scale }
  }

  for (const k of [1.5, 0.75, 2, 1]) {
    it(`reaches it and presses it at a text scale of ${k}`, async () => {
      const { result, presses, finalBox } = await run(k)
      expect(result.steps[0], JSON.stringify(result.steps[0]?.error)).toMatchObject({ status: 'ran' })
      expect(presses).toHaveLength(1)
      // The press is inside the element as it stands after the scroll, in surface px.
      expect(presses[0]!.y).toBeGreaterThanOrEqual(finalBox.y)
      expect(presses[0]!.y).toBeLessThan(finalBox.y + finalBox.height)
      // And the element landed a third of the way down the surface, clear of a fixed header.
      expect(finalBox.y).toBeGreaterThan(120)
      expect(Math.abs(finalBox.y - SURFACE.cssHeight / 3)).toBeLessThanOrEqual(k)
    })
  }

  it('scrolls in page px: 1.5x the surface distance would be the bug', async () => {
    const { scrolls } = await run(1.5)
    // The element is 2216 page px down; a third of the 852 px surface is 568/3 = 189.3 page px of the 568 px
    // layout viewport. The target is therefore about 2026, not the 3040 that mixing the units produced.
    expect(scrolls).toHaveLength(1)
    expect(scrolls[0]!['y'] as number).toBeGreaterThan(2000)
    expect(scrolls[0]!['y'] as number).toBeLessThan(2100)
  })

  it('treats a status with no textScale as scale 1 — an app older than the field', async () => {
    const { result, scrolls } = await run(undefined)
    expect(result.steps[0], JSON.stringify(result.steps[0]?.error)).toMatchObject({ status: 'ran' })
    expect(scrolls[0]!['y']).toBe(Math.round(P - SURFACE.cssHeight / 3))
  })

  // `readStatus` reads a scale only when it is a positive number. An app clamps its scale to a published
  // range, so none of these is reachable from a real one; the guard is there so a malformed reply cannot
  // become a division by zero (Infinity) or by a negative (a scroll the wrong way) inside `scrollToShow`,
  // and a guard nothing exercises is a comment, not a guard (Idris's gate on `#544`, survivor of 7).
  for (const reported of [0, -1, -1.5, 'wide', null, Number.NaN]) {
    it(`reads a reported text scale of ${JSON.stringify(reported)} as scale 1 rather than dividing by it`, async () => {
      const { result, scrolls, presses, finalBox } = await run(1, reported)
      expect(result.steps[0], JSON.stringify(result.steps[0]?.error)).toMatchObject({ status: 'ran' })
      expect(scrolls).toHaveLength(1)
      expect(scrolls[0]!['y']).toBe(Math.round(P - SURFACE.cssHeight / 3))
      expect(presses).toHaveLength(1)
      expect(presses[0]!.y).toBeGreaterThanOrEqual(finalBox.y)
      expect(presses[0]!.y).toBeLessThan(finalBox.y + finalBox.height)
    })
  }
})
