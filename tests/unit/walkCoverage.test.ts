import { describe, expect, it } from 'vitest'
import { walkCoverageNote, walkDialogNote } from '../../src/shared/walkCoverage'

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
 * A page locked behind a dialog leaves the dialog's own panel as the only
 * scroller, so the walk scrolls that and reports screenfuls and an end that
 * belong to a 300 px panel rather than the page (measured 2026-09-12 on a
 * fixture, and on airbnb.com's consent dialog).
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

  it('reads sensibly when the dialog did not move either', () => {
    expect(walkDialogNote(0)).toContain('the page never moved')
  })
})
