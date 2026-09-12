import { describe, expect, it } from 'vitest'
import { SHADOW_HIDDEN_CEILING, SHADOW_HIDDEN_FLOOR, SHADOW_SHARE_FLOOR, shadowShareNote } from '../../src/shared/shadowShare'
import type { ShadowContent } from '../../src/shared/emptyDocument'

/**
 * A page that measures fine and hides half of itself said nothing at all
 * (run 15, 2026-09-12): 12 buttons in the light DOM, 40 more inside four open
 * shadow roots, and the answer was "12 targets, 12 findings, 0 warnings".
 * `shadowContent` had counted the 40 on the way past — the counts were read
 * only when the light DOM was *completely* empty, in all four places that
 * read them.
 *
 * The test that makes it a defect rather than a quiet tool: name the two
 * facts that would each produce the silence. A page with no roots at all and
 * a page hiding 40 of 52 produced the same output.
 */

const shadow = (o: Partial<ShadowContent>): ShadowContent => ({
  hosts: 1,
  interactive: 0,
  text: 0,
  lightInteractive: 0,
  lightText: 0,
  ...o,
})

describe('shadowShareNote', () => {
  it('names what four roots hide on the page that exposed this', () => {
    const note = shadowShareNote('audit', shadow({ hosts: 4, interactive: 40, lightInteractive: 12 }))
    expect(note).toBe(
      "4 shadow roots hold 40 of this page's 52 interactive elements, which the measurement does not enter: " +
        'the figures above are of the light DOM alone',
    )
  })

  it('tells each command about the kind of thing it measures', () => {
    const s = shadow({ hosts: 2, interactive: 12, text: 30, lightInteractive: 40, lightText: 30 })
    expect(shadowShareNote('audit', s)).toContain("12 of this page's 52 interactive elements")
    // lint measures text, edges and images; the interactive count would be a
    // number about somebody else's rules.
    expect(shadowShareNote('lint', s)).toContain("30 of this page's 60 text elements")
  })

  it('says nothing when there are no roots, and nothing when the roots hold nothing', () => {
    expect(shadowShareNote('audit', shadow({ hosts: 0, lightInteractive: 52 }))).toBeNull()
    // Four components that hold no control hide no control. A threshold in
    // hosts rather than in hidden elements would fire here.
    expect(shadowShareNote('audit', shadow({ hosts: 4, interactive: 0, lightInteractive: 52 }))).toBeNull()
  })

  it('leaves the empty page to the note that can say more about it', () => {
    // emptyDocumentNote can say the page is *built* from components. Two
    // sentences describing one page is what the 404 work spent a day
    // removing.
    expect(shadowShareNote('audit', shadow({ hosts: 4, interactive: 52, lightInteractive: 0 }))).toBeNull()
  })

  it('stays quiet for a widget and speaks for a page', () => {
    // 4 of 52 is 7.7%: the reader's figures are materially right.
    expect(shadowShareNote('audit', shadow({ interactive: 4, lightInteractive: 48 }))).toBeNull()
    // 8 of 52 is 15.4%: one control in six could not be measured.
    expect(shadowShareNote('audit', shadow({ hosts: 2, interactive: 8, lightInteractive: 44 }))).toContain('8 of')
  })

  it('needs a real number hidden as well as a real share, so a tiny page is not half a page', () => {
    // 2 of 4 is 50% and is a four-control page with one widget on it.
    expect(shadowShareNote('audit', shadow({ interactive: 2, lightInteractive: 2 }))).toBeNull()
    // 3 of 6 clears both floors, and half of that page cannot be measured.
    expect(shadowShareNote('audit', shadow({ interactive: 3, lightInteractive: 3 }))).toContain("3 of this page's 6")
  })

  it('says nothing when the page did not send the denominator', () => {
    // An older app sends hosts/interactive/text and no light counts. A share
    // of a number that was not measured is the defect this note fixes.
    const old: ShadowContent = { hosts: 4, interactive: 40, text: 4 }
    expect(shadowShareNote('audit', old)).toBeNull()
    expect(shadowShareNote('audit', undefined)).toBeNull()
  })

  it('agrees with its own floors', () => {
    // The floors are the sentence's contract, not decoration: a change to
    // either should fail here and be argued, not slip through.
    expect(SHADOW_SHARE_FLOOR).toBe(0.15)
    expect(SHADOW_HIDDEN_FLOOR).toBe(3)
  })

  it('counts one root in the singular, verb included', () => {
    const note = shadowShareNote('audit', shadow({ hosts: 1, interactive: 3, lightInteractive: 3 }))
    expect(note).toContain('1 shadow root holds 3')
    expect(note).not.toContain('1 shadow roots')
    expect(note).not.toContain('root hold ')
  })
})

describe('the share floor on a page the share floor was not chosen for', () => {
  const big = (hosts: number, hidden: number, light: number): ShadowContent => ({
    hosts,
    interactive: hidden,
    text: 0,
    lightInteractive: light,
    lightText: 0,
  })

  it('speaks when a lot is hidden, even where the share is small', () => {
    // 60 of 560 is 10.7% and was silent: sixty controls nobody measured, on
    // a page big enough for the share to hide them. The floors were chosen
    // on pages of about fifty (run 15) and did not scale.
    expect(shadowShareNote('audit', big(6, 60, 500))).toContain("60 of this page's 560")
    // 40 of 940 is 4.3% and is still forty controls.
    expect(shadowShareNote('audit', big(4, 40, 900))).toContain("40 of this page's 940")
  })

  it('stays quiet for a handful on a large page', () => {
    // 10 of 510 reads as trivia, and the sentence costs more than it says.
    expect(shadowShareNote('audit', big(1, 10, 500))).toBeNull()
    // The shape obsrv-4f asked to see decided rather than defaulted: 4 of 44
    // is 9.1%, four controls, and below both lines. It stays silent.
    expect(shadowShareNote('audit', big(1, 4, 40))).toBeNull()
  })

  it('leaves the absolute to the audit, because a text count is not comparable across pages', () => {
    // Measured the same day on four live sites: text elements per
    // interactive element ran 1.15 (ikea), 1.19 (ft), 1.47 (gov.uk) and 5.75
    // (linear) — a spread of five. 25 hidden text elements is a card on one
    // page and a section on another, so lint keeps the share, which scales.
    expect(shadowShareNote('lint', { hosts: 4, interactive: 0, text: 60, lightInteractive: 300, lightText: 2000 })).toBeNull()
    // And still speaks when the share is real.
    expect(shadowShareNote('lint', { hosts: 4, interactive: 0, text: 400, lightInteractive: 300, lightText: 2000 })).toContain(
      "400 of this page's 2400 text elements",
    )
  })

  it('agrees with its own ceiling', () => {
    expect(SHADOW_HIDDEN_CEILING).toBe(25)
    // The two conditions are ORed: a small page still needs a real share.
    expect(shadowShareNote('audit', big(1, 24, 500))).toBeNull()
    expect(shadowShareNote('audit', big(1, 25, 500))).toContain("25 of this page's 525")
  })
})
