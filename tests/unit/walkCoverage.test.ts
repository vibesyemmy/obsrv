import { describe, expect, it } from 'vitest'
import { walkCoverageNote, walkDialogNote, walkNothingNote } from '../../src/shared/walkCoverage'

describe('walkCoverageNote', () => {
  it('is silent when the walk covered the page', () => {
    expect(walkCoverageNote({ screenfuls: 14, atEnd: true }, 768, 11_000)).toBeNull()
    expect(walkCoverageNote({ screenfuls: 0, atEnd: true }, 768, 700)).toBeNull()
    // Half a screenful of slack for rounding.
    expect(walkCoverageNote({ screenfuls: 2, atEnd: true }, 768, 2304 + 380)).toBeNull()
  })
  it('is silent when the walk did not reach the end: that case has its own note', () => {
    expect(walkCoverageNote({ screenfuls: 3, atEnd: false }, 768, 20_000)).toBeNull()
  })
  it('is silent without a walk or without heights', () => {
    expect(walkCoverageNote(undefined, 768, 20_000)).toBeNull()
    expect(walkCoverageNote({ screenfuls: 0, atEnd: true }, 0, 20_000)).toBeNull()
    expect(walkCoverageNote({ screenfuls: 0, atEnd: true }, 768, 0)).toBeNull()
  })
  it("names the gap when the walk saw the end of a page it never crossed (the Guardian's consent layer)", () => {
    expect(walkCoverageNote({ screenfuls: 0, atEnd: true }, 768, 20_596)).toBe(
      'the walk saw the end after 0 screenfuls (768 CSS px), but the page measures 20596 CSS px (27 screenfuls): a modal or a ' +
        'locked scroll held the page, or it grew after the walk; the measurement is of the page as it stands, and nothing below 768 px ' +
        'was scrolled into view',
    )
    expect(walkCoverageNote({ screenfuls: 1, atEnd: true }, 800, 5_000)).toMatch(/after 1 screenful \(1600 CSS px\)/)
  })
})

/**
 * A page locked behind a dialog leaves its panel as the only scroller, so the
 * walk scrolls that and reports screenfuls and an end that belong to a 300 px
 * panel rather than the page.
 *
 * Pinned on a fixture and never seen live. This comment used to add "and on
 * airbnb.com's consent dialog"; the same day's report withdrew that claim in
 * full, and what survived was the mechanism rather than the site. The second
 * copy of a stale citation, found while fixing the first (2026-09-13).
 */
/**
 * Which cause the note names. Measured 2026-09-12 on theguardian.com (9
 * screenfuls of a 21,440 px page), spiegel.de (10 of 34,582) and
 * nytimes.com (6 of 9,741): each was told "a modal or a locked scroll held
 * the page" about a page whose root the walk had just scrolled to its end,
 * which sends the reader after something that is not there. The walk knows
 * whether the document was locked when it stopped; the sentence should use
 * it.
 */
describe('walkCoverageNote names the cause it can rule out', () => {
  const walked = { screenfuls: 9, atEnd: true }

  it('a page that scrolled and came up short grew: no modal in the sentence', () => {
    const note = walkCoverageNote(walked, 1200, 21_440, { documentLocked: false })!
    expect(note).toContain('grew as it was walked')
    expect(note).not.toContain('a modal or a locked scroll')
    // The figures the reader acts on are unchanged.
    expect(note).toContain('9 screenfuls')
    expect(note).toContain('21440 CSS px')
    expect(note).toContain('nothing below 12000 px was scrolled into view')
  })

  it('a page locked when the walk stopped keeps the modal reading', () => {
    const note = walkCoverageNote(walked, 1200, 21_440, { documentLocked: true })!
    expect(note).toContain('a modal or a locked scroll held the page')
  })

  it('says nothing new when the caller cannot tell: the cautious sentence stands', () => {
    const note = walkCoverageNote(walked, 1200, 21_440)!
    expect(note).toContain('a modal or a locked scroll held the page')
    expect(note).toContain('or it grew after the walk')
  })

  it('a walk that went nowhere reads as held, whatever the flag says', () => {
    // Zero screenfuls on a tall page is the shape a lock makes, and the
    // document may be locked by something the flag does not see.
    const note = walkCoverageNote({ screenfuls: 0, atEnd: true }, 1200, 21_440, { documentLocked: false })!
    expect(note).toContain('a modal or a locked scroll held the page')
  })
})

describe('walkDialogNote', () => {
  it('says the screenfuls were the dialog\'s, and what that cost', () => {
    const note = walkDialogNote(5)
    expect(note).toContain('scrolled a dialog, not the page')
    expect(note).toContain('5 screenfuls')
    expect(note).toContain('was not brought into view before measuring')
  })

  it('counts one screenful in the singular', () => {
    expect(walkDialogNote(1)).toContain('1 screenful ')
    expect(walkDialogNote(1)).not.toContain('1 screenfuls')
  })

  it('does not claim it scrolled something it could not move', () => {
    // The zero shape opened "the walk scrolled a dialog" and closed "the
    // dialog did not move either", contradicting itself in one sentence —
    // seen only once all six shapes were printed together (2026-09-13).
    const note = walkDialogNote(0)
    expect(note).toContain('could not move the page or the dialog over it')
    expect(note).not.toContain('the walk scrolled a dialog')
  })

  it('speaks for a panel with no dialog semantics, which used to be silent', () => {
    // Strip role="dialog" from the fixture and the whole answer was empty,
    // for a page whose panel scrolled five screenfuls while the page never
    // moved. The gate is now the measurement — an element scroller on a
    // locked document — and the dialog wording is layered on top of it.
    const anon = walkDialogNote(5, false)
    expect(anon).toContain('the walk scrolled a panel on the page, not the page itself')
    expect(anon).toContain("are that panel's and the page never moved")
    expect(anon).not.toContain('dialog')
    // And the zero shape of the same case does not claim a scroll either.
    expect(walkDialogNote(0, false)).toContain('could not move the page or the panel on it')
  })
})

/**
 * The walk's "nothing to scroll" sentence used to be a bare constant naming
 * three causes: an iframe, a shadow root, a container that scrolls by
 * transform. On ft.com it offered all three while the measurement held the
 * answer — one iframe covering 100% of the viewport (a consent wall), zero
 * shadow hosts (run 15, 2026-09-12). Both counts are taken on the same
 * unconditional line as everything else the walk sees.
 */
describe('walkNothingNote', () => {
  it('names the wall on the page that exposed this', () => {
    const note = walkNothingNote({ frames: { count: 1, viewportCoverage: 1 }, shadowHosts: 0 })
    expect(note).toContain('an <iframe> covers 100% of the viewport')
    expect(note).toContain('a consent wall, a paywall or an onboarding layer holds it')
    // The three-guess list is what it replaces.
    expect(note).not.toContain('content in an iframe, in a shadow root, or in a container')
  })

  it('does not call a small embed a wall', () => {
    const note = walkNothingNote({ frames: { count: 1, viewportCoverage: 0.2 }, shadowHosts: 0 })
    expect(note).toContain('20% of the viewport')
    expect(note).not.toContain('consent wall')
  })

  it('names shadow roots when there is no frame over the page', () => {
    expect(walkNothingNote({ frames: { count: 0, viewportCoverage: 0 }, shadowHosts: 12 })).toContain('12 open shadow roots')
    expect(walkNothingNote({ frames: { count: 0, viewportCoverage: 0 }, shadowHosts: 1 })).toContain('1 open shadow root,')
  })

  it('keeps one guess when both were measured and neither explains it', () => {
    const note = walkNothingNote({ frames: { count: 0, viewportCoverage: 0 }, shadowHosts: 0 })
    expect(note).toContain('no iframe covers the viewport and the page has no open shadow roots')
    expect(note).toContain('scrolls by transform')
  })

  it('claims no measurement it was not given', () => {
    // The failure this branch exists for: printed at the no-argument shape,
    // the sentence asserted "no iframe covers the viewport and the page has
    // no open shadow roots" from a caller that had looked for neither —
    // which is the defect the whole function removes, produced by it.
    for (const blocked of [undefined, { frames: { count: 0, viewportCoverage: 0 } }, { shadowHosts: 0 }]) {
      const note = walkNothingNote(blocked)
      expect(note).toContain('content in an iframe, in a shadow root, or in a container')
      expect(note).not.toContain('no iframe covers the viewport')
    }
  })
})

describe('walkCoverageNote beside a named wall', () => {
  const walked = { screenfuls: 0, atEnd: true }

  it('stops offering a cause once the wall above has named one', () => {
    const note = walkCoverageNote(walked, 1080, 8337, {
      documentLocked: true,
      blocked: { frames: { count: 1, viewportCoverage: 1 }, shadowHosts: 0 },
    })
    expect(note).toContain('(8 screenfuls)')
    // ft.com carried both sentences: the second hedged what the first
    // established, and offered a page that grew — which a page that never
    // moved did not do.
    expect(note).not.toContain('a modal or a locked scroll held the page')
    expect(note).not.toContain('grew after the walk')
    // Beside a named wall it keeps only what it alone has — the two numbers.
    // "The walk saw the end after 0 screenfuls" is wrong for a walk that was
    // stopped, and the rest restated the wall note (the sweep, 2026-09-13).
    expect(note).toBe('the page measures 8337 CSS px (8 screenfuls); the walk reached the first 1080 px of it')
    expect(note).not.toContain('the walk saw the end')
  })

  it('keeps the cause when no wall was measured', () => {
    expect(walkCoverageNote(walked, 1080, 8337, { documentLocked: true })).toContain('a modal or a locked scroll held the page')
    expect(
      walkCoverageNote(walked, 1080, 8337, { documentLocked: true, blocked: { frames: { count: 1, viewportCoverage: 0.2 }, shadowHosts: 0 } }),
    ).toContain('a modal or a locked scroll held the page')
  })
})
