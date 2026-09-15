import { describe, expect, it } from 'vitest'
import { contrastRatio, relativeLuminance } from '../../src/shared/contrast'

/**
 * Where the contrast figure and the colours printed beside it stop agreeing.
 *
 * Run 17 found `a.upvoter` on lobste.rs reported as `#ffffff` on `#0c0c0c` with
 * a ratio of **7.5**, from both `lint` and `inspect`. White on `#0c0c0c` is
 * 19.56 by the WCAG 2 formula. The same tool reported `#0b0c0c` on `#d2e2f1`
 * as 14.82, where the formula gives 14.82 — right there, wrong here.
 *
 * Two hypotheses were already in hand before this file existed: the ratio is
 * computed against a composited background while the sentence prints the
 * computed `background-color`, or the reverse. Both are guesses, and the card
 * says not to fix the arithmetic on the strength of them.
 *
 * **So this measures one level below both of them.** If `contrastRatio` returns
 * the right number for the colours run 17 printed, the arithmetic is innocent
 * and the value fed to it is wrong. If it returns 7.5, the arithmetic is the
 * fault and neither hypothesis is needed. One table, and the space is halved.
 *
 * Expected values are not taken from the implementation. 21:1 for black on
 * white is the canonical figure WCAG itself quotes; the rest are computed from
 * the published formula — L = 0.2126R + 0.7152G + 0.0722B on linearised
 * channels, ratio (Lhi + 0.05) / (Llo + 0.05).
 */
const WHITE: [number, number, number] = [255, 255, 255]
const BLACK: [number, number, number] = [0, 0, 0]
/** lobste.rs's page background, and the case that was wrong in the field. */
const NEAR_BLACK: [number, number, number] = [12, 12, 12]
/** gov.uk's heading pair, and the case that was right in the field. */
const GOV_TEXT: [number, number, number] = [11, 12, 12]
const GOV_BG: [number, number, number] = [210, 226, 241]

describe('contrastRatio: the arithmetic, against figures computed outside it', () => {
  it('black on white is 21:1, the figure WCAG itself quotes', () => {
    expect(contrastRatio(BLACK, WHITE)).toBeCloseTo(21, 2)
  })

  it('white on #0c0c0c is 19.56:1 — the pair run 17 saw reported as 7.5', () => {
    // If this passes, the formula is not the fault and the background handed
    // to it is. If it fails, the field figure is explained here and no
    // hypothesis about compositing is needed at all.
    expect(contrastRatio(WHITE, NEAR_BLACK)).toBeCloseTo(19.56, 1)
  })

  it('#0b0c0c on #d2e2f1 is 14.82:1 — the pair the tool got right in the field', () => {
    expect(contrastRatio(GOV_TEXT, GOV_BG)).toBeCloseTo(14.82, 1)
  })

  it('is order-independent, so light-on-dark cannot differ from dark-on-light', () => {
    // The only structural way "right on dark-on-light, wrong on light-on-dark"
    // could live in this function. If the two directions agree, that boundary
    // is not here.
    expect(contrastRatio(WHITE, NEAR_BLACK)).toBeCloseTo(contrastRatio(NEAR_BLACK, WHITE), 6)
    expect(contrastRatio(GOV_TEXT, GOV_BG)).toBeCloseTo(contrastRatio(GOV_BG, GOV_TEXT), 6)
  })

  it('luminance is 1 for white, 0 for black, and monotonic between', () => {
    expect(relativeLuminance(WHITE)).toBeCloseTo(1, 6)
    expect(relativeLuminance(BLACK)).toBeCloseTo(0, 6)
    expect(relativeLuminance(NEAR_BLACK)).toBeGreaterThan(relativeLuminance(BLACK))
    expect(relativeLuminance(NEAR_BLACK)).toBeLessThan(relativeLuminance([64, 64, 64]))
  })

  it('a ratio of 7.5 for white text implies a background near #545454, not #0c0c0c', () => {
    // The hypothesis stated as a number so it can be checked rather than
    // believed: if the field figure came from a background this function was
    // given, that background was a mid grey.
    const midGrey: [number, number, number] = [84, 84, 84]
    expect(contrastRatio(WHITE, midGrey)).toBeCloseTo(7.5, 0)
  })
})
