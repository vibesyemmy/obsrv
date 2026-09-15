import { describe, expect, it } from 'vitest'
import { contrastRatio, effectiveContrast, over, paintedColor } from '../../src/shared/contrast'
import type { PanelParams } from '../../src/shared/types'

/**
 * The colour a reader is shown, beside the ratio that was computed.
 *
 * Measured on 2026-09-15: a translucent text colour was composited for the
 * ratio and printed with its alpha discarded. `rgba(255,255,255,.62)` on
 * `#0c0c0c` reported `#ffffff` and 7.72, and 7.72 is the true ratio of the
 * `#a3a3a3` actually painted. The number described the screen; the hex beside
 * it did not, and anyone checking the arithmetic found 19.56 and concluded the
 * tool was broken.
 *
 * And an element `opacity` reached neither half: the same grey reported
 * `#ffffff` on `#0c0c0c` at 19.56, where the verdict itself is wrong.
 *
 * Both halves now come from one place, so they cannot drift apart again.
 */
const REFERENCE: PanelParams = { blackFloor: 0, gamutCoverage: 1, bits: 8, frc: false, nits: null }

describe('paintedColor: what the screen actually shows', () => {
  it('composites a translucent colour onto what is under it', () => {
    // White at 62% over #0c0c0c is #a3a3a3 — the colour lobste.rs paints and
    // the one its ratio was already describing.
    expect(paintedColor([255, 255, 255, 0.62], [12, 12, 12, 1], 1)).toEqual(expect.arrayContaining([]))
    const painted = paintedColor([255, 255, 255, 0.62], [12, 12, 12, 1], 1)
    expect(painted.map(Math.round)).toEqual([163, 163, 163])
    expect(contrastRatio(painted, [12, 12, 12])).toBeCloseTo(7.72, 1)
  })

  it('folds an element opacity into the same answer', () => {
    // opacity: .62 on white text paints the same grey as rgba(...,.62) does.
    // Before this, opacity reached neither the colour nor the ratio.
    const viaOpacity = paintedColor([255, 255, 255, 1], [12, 12, 12, 1], 0.62)
    const viaAlpha = paintedColor([255, 255, 255, 0.62], [12, 12, 12, 1], 1)
    expect(viaOpacity.map(Math.round)).toEqual(viaAlpha.map(Math.round))
  })

  it('multiplies opacity and alpha, because a page can use both', () => {
    const both = paintedColor([255, 255, 255, 0.5], [0, 0, 0, 1], 0.5)
    expect(both.map(Math.round)).toEqual(over([255, 255, 255, 0.25], [0, 0, 0]).map(Math.round))
  })

  it('leaves an opaque colour at full opacity exactly as stated', () => {
    // The commonest case must not move: gov.uk was right before and after.
    expect(paintedColor([11, 12, 12, 1], [210, 226, 241, 1], 1).map(Math.round)).toEqual([11, 12, 12])
  })
})

describe('effectiveContrast: the ratio now accounts for opacity too', () => {
  it('an opacity that greys the text lowers the ratio', () => {
    // The defect: this used to report 19.56, the ratio of a white that is not
    // on the screen.
    const withOpacity = effectiveContrast([255, 255, 255, 1], [12, 12, 12, 1], REFERENCE, undefined, 0.62)
    expect(withOpacity.asIs).toBeCloseTo(7.72, 1)
  })

  it('full opacity is unchanged, so every existing verdict stands', () => {
    const plain = effectiveContrast([255, 255, 255, 1], [12, 12, 12, 1], REFERENCE, undefined, 1)
    expect(plain.asIs).toBeCloseTo(19.56, 1)
    const gov = effectiveContrast([11, 12, 12, 1], [210, 226, 241, 1], REFERENCE, undefined, 1)
    expect(gov.asIs).toBeCloseTo(14.82, 1)
  })

  it('omitting opacity behaves as fully opaque', () => {
    const a = effectiveContrast([255, 255, 255, 1], [12, 12, 12, 1], REFERENCE)
    const b = effectiveContrast([255, 255, 255, 1], [12, 12, 12, 1], REFERENCE, undefined, 1)
    expect(a.asIs).toBeCloseTo(b.asIs, 6)
  })
})
