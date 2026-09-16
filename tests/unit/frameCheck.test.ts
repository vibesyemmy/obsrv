import { describe, expect, it } from 'vitest'
import { frameIdentityWarning, isFrameIdentityWarning } from '../../src/main/frameCheck'

describe('frameIdentityWarning', () => {
  it('is silent when the renderer drew the frame main last sent', () => {
    expect(frameIdentityWarning(12, 12, true)).toBeNull()
    expect(frameIdentityWarning(13, 12, true)).toBeNull()
  })
  it('is silent before any frame was sent at all', () => {
    expect(frameIdentityWarning(null, 0, true)).toBeNull()
  })
  it('names the lag when the renderer drew an older frame than the latest sent', () => {
    expect(frameIdentityWarning(7, 12, true)).toBe('the pane may show an older frame: the renderer drew frame 7, the latest sent to it is 12')
  })
  it('says so when the renderer answered without a frame number', () => {
    expect(frameIdentityWarning(null, 12, true)).toMatch(/did not say which frame it drew/)
  })
  it('says so when delivery has not been subscribed, whatever the numbers', () => {
    expect(frameIdentityWarning(12, 12, false)).toMatch(/not being delivered to the pane/)
  })
})

describe('isFrameIdentityWarning', () => {
  it('recognises every sentence frameIdentityWarning can produce', () => {
    // Generated FROM the producer rather than written out again: that is the
    // whole point of the predicate. A reword that this test had to be edited
    // for would be a reword the e2e spec was already blind to.
    const produced = [
      frameIdentityWarning(0, 1, false),
      frameIdentityWarning(null, 1, true),
      frameIdentityWarning(1, 2, true),
    ]
    expect(produced.every(w => w !== null)).toBe(true)
    for (const w of produced) expect(isFrameIdentityWarning(w!), w!).toBe(true)
  })

  it('does not claim the other sentences a capture carries', () => {
    // The live capture's reply holds settle and blank warnings too, and a
    // predicate that swept those in would fail a healthy capture.
    for (const other of [
      'the page was still painting when the capture budget ran out; the PNG may show a transitional frame',
      "the frame is one colour end to end and stayed that way for the capture's 3000 ms",
      'the renderer has not reported the pane bounds yet; captured the full window instead',
    ]) {
      expect(isFrameIdentityWarning(other), other).toBe(false)
    }
  })
})
