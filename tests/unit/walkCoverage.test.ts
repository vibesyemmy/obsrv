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
