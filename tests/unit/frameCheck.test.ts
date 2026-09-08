import { describe, expect, it } from 'vitest'
import { frameIdentityWarning } from '../../src/main/frameCheck'

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
