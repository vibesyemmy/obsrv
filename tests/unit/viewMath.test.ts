import { describe, it, expect } from 'vitest'
import { centreScroll, computeFitScale, jumpScroll } from '../../src/renderer/src/view/viewMath'

describe('computeFitScale', () => {
  it('picks the limiting axis', () => {
    // Width limits: 800/1600 = 0.5 beats 600/600 = 1.
    expect(computeFitScale(800, 600, 1, 1600, 600, 2)).toBe(0.5)
    // Height limits.
    expect(computeFitScale(800, 300, 1, 800, 600, 2)).toBe(0.5)
  })

  it('measures the pane in device pixels via dpr', () => {
    // An 800×450 CSS pane on a 2x host is 1600×900 device pixels.
    expect(computeFitScale(800, 450, 2, 1920, 1080, 2)).toBeCloseTo(1600 / 1920, 12)
  })

  it('never enlarges past 1:1, however roomy the pane', () => {
    expect(computeFitScale(4000, 4000, 1, 100, 100, 1.5)).toBe(1.5)
  })

  it('equals the 1:1 scale exactly when the pane just fits', () => {
    // 1920×1080 at ×2 in a 3840×2160 device-pixel pane.
    expect(computeFitScale(3840, 2160, 1, 1920, 1080, 2)).toBe(2)
  })

  it('falls back to 1 on a non-finite or non-positive input', () => {
    expect(computeFitScale(0, 600, 1, 1920, 1080, 2)).toBe(1)
    expect(computeFitScale(800, 0, 1, 1920, 1080, 2)).toBe(1)
    expect(computeFitScale(800, 600, 0, 1920, 1080, 2)).toBe(1)
    expect(computeFitScale(800, 600, 1, 0, 1080, 2)).toBe(1)
    expect(computeFitScale(800, 600, 1, 1920, 0, 2)).toBe(1)
    expect(computeFitScale(800, 600, 1, 1920, 1080, 0)).toBe(1)
    expect(computeFitScale(Number.NaN, 600, 1, 1920, 1080, 2)).toBe(1)
    expect(computeFitScale(800, 600, 1, 1920, 1080, Number.POSITIVE_INFINITY)).toBe(1)
    expect(computeFitScale(800, 600, 1, 1920, 1080, Number.NaN)).toBe(1)
  })
})

describe('jumpScroll', () => {
  // 1920×1080 viewport, ×2 at 1:1, fit ×0.5, 800×600 pane, 1x host.
  const args = { dpr: 1, fit: 0.5, s: 2, paneW: 800, paneH: 600, vpW: 1920, vpH: 1080 }
  const jump = (x: number, y: number, over: Partial<typeof args> = {}) => {
    const a = { ...args, ...over }
    return jumpScroll(x, y, a.dpr, a.fit, a.s, a.paneW, a.paneH, a.vpW, a.vpH)
  }

  it('centres the clicked target pixel in the pane', () => {
    // Click (400, 300) → target pixel (800, 600) → at ×2 that is CSS (1600,
    // 1200); centring subtracts half the pane.
    expect(jump(400, 300)).toEqual({ left: 1600 - 400, top: 1200 - 300 })
  })

  it('holds the centring property: scroll + pane/2 = target × S / dpr', () => {
    const { left, top } = jump(500, 200)
    expect(left + args.paneW / 2).toBeCloseTo(((500 * args.dpr) / args.fit) * args.s, 10)
    expect(top + args.paneH / 2).toBeCloseTo(((200 * args.dpr) / args.fit) * args.s, 10)
  })

  it('divides the click by dpr through the fit scale', () => {
    // Same target pixel (800, 600) as the centring case, measured on a 2x
    // host with the fit scale doubled — but CSS positions halve on a 2x
    // host, so the scroll offsets halve with them.
    expect(jump(400, 300, { dpr: 2, fit: 1 })).toEqual({ left: 800 - 400, top: 600 - 300 })
  })

  it('clamps at the origin for a click near the top-left', () => {
    expect(jump(10, 10)).toEqual({ left: 0, top: 0 })
  })

  it('clamps at the far edge for a click near the bottom-right', () => {
    // Full range: 1920×2 − 800 = 3040, 1080×2 − 600 = 1560.
    expect(jump(950, 535)).toEqual({ left: 3040, top: 1560 })
  })

  it('stays at the origin when the 1:1 canvas fits the pane', () => {
    expect(jump(100, 100, { vpW: 300, vpH: 200, fit: 2 })).toEqual({ left: 0, top: 0 })
  })

  it('yields the origin, never NaN, on bad inputs', () => {
    expect(jump(Number.NaN, 10)).toEqual({ left: 0, top: 0 })
    expect(jump(10, 10, { fit: 0 })).toEqual({ left: 0, top: 0 })
    expect(jump(10, 10, { s: Number.NaN })).toEqual({ left: 0, top: 0 })
    expect(jump(10, 10, { paneW: 0 })).toEqual({ left: 0, top: 0 })
  })
})

describe('centreScroll', () => {
  // Same geometry as the jumpScroll cases: 1920×1080 viewport, ×2 at 1:1,
  // 800×600 pane, 1x host — but addressed by target pixel directly.
  const args = { dpr: 1, s: 2, paneW: 800, paneH: 600, vpW: 1920, vpH: 1080 }
  const centre = (x: number, y: number, over: Partial<typeof args> = {}) => {
    const a = { ...args, ...over }
    return centreScroll(x, y, a.dpr, a.s, a.paneW, a.paneH, a.vpW, a.vpH)
  }

  it('centres the target pixel in the pane', () => {
    expect(centre(800, 600)).toEqual({ left: 1600 - 400, top: 1200 - 300 })
  })

  it('agrees with jumpScroll for the pixel under a fit click', () => {
    // Fit ×0.5 click (400, 300) is target pixel (800, 600).
    expect(centre(800, 600)).toEqual(jumpScroll(400, 300, 1, 0.5, 2, 800, 600, 1920, 1080))
  })

  it('divides CSS positions by dpr on a dense host', () => {
    expect(centre(800, 600, { dpr: 2, s: 2 })).toEqual({ left: 800 - 400, top: 600 - 300 })
  })

  it('clamps to the scrollable range at both ends', () => {
    expect(centre(0, 0)).toEqual({ left: 0, top: 0 })
    // Full range: 1920×2 − 800 = 3040, 1080×2 − 600 = 1560.
    expect(centre(1920, 1080)).toEqual({ left: 3040, top: 1560 })
  })

  it('stays at the origin when the 1:1 canvas fits the pane', () => {
    expect(centre(100, 100, { vpW: 300, vpH: 200 })).toEqual({ left: 0, top: 0 })
  })

  it('yields the origin, never NaN, on bad inputs', () => {
    expect(centre(Number.NaN, 10)).toEqual({ left: 0, top: 0 })
    expect(centre(10, 10, { s: 0 })).toEqual({ left: 0, top: 0 })
    expect(centre(10, 10, { paneH: Number.NaN })).toEqual({ left: 0, top: 0 })
  })
})
