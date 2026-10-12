import { describe, expect, it } from 'vitest'
import { measuredElsewhereNote } from '../../src/shared/measureBudget'

// bug-measured-page-is-not-the-asked-page: the sentence for figures of a page
// the caller never asked for, which no other note has named.
describe('measuredElsewhereNote', () => {
  const A = 'file:///fixtures/tall.html'
  const B = 'file:///fixtures/hairline.html'

  it('names the page measured first, then the page asked for', () => {
    expect(measuredElsewhereNote(A, A, B)).toBe(
      `the figures are of ${B}, not of ${A}, which the last navigate asked for: ` +
        `this pane moved there after the navigate without the page moving itself, most often Obsrv's sync loading the page its other pane reached`,
    )
  })

  it('says nothing when the page measured is the one the notes before it named', () => {
    // Nothing moved: the page asked for is the page measured.
    expect(measuredElsewhereNote(A, A, A)).toBeNull()
    // The navigated note or the landed note already named B, so the journey is said once.
    expect(measuredElsewhereNote(A, B, B)).toBeNull()
  })

  it('speaks when the page measured is past the one the notes before it named', () => {
    // The load landed on B and was then carried on to C, which nothing has named.
    const C = 'file:///fixtures/redirect.html'
    expect(measuredElsewhereNote(A, B, C)).toContain(`the figures are of ${C}, not of ${A}`)
  })

  it('says nothing when no page has committed yet', () => {
    expect(measuredElsewhereNote(A, A, '')).toBeNull()
  })

  it('compares addresses as the loader spells them, as the landed note does', () => {
    // A bare host is loaded as https, a trailing slash is not a different page, and neither is an upgrade to https.
    expect(measuredElsewhereNote('example.com', 'example.com', 'https://example.com/')).toBeNull()
    expect(measuredElsewhereNote('http://example.com', 'http://example.com', 'https://example.com')).toBeNull()
    // The page asked for is named as the loader spelled it, so the sentence and the reply's url agree.
    expect(measuredElsewhereNote('example.com', 'example.com', 'https://example.com/login')).toContain(
      'the figures are of https://example.com/login, not of https://example.com,',
    )
  })

  it('never says the page navigated, because the bus moved the pane and the count is right about that', () => {
    expect(measuredElsewhereNote(A, A, B)).not.toMatch(/navigated after it loaded/)
  })
})
