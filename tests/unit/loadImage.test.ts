import { describe, it, expect } from 'vitest'
import { exceedsLimits, isSupported } from '../../src/renderer/src/image/loadImage'

describe('isSupported', () => {
  it('accepts PNG and JPEG by MIME type', () => {
    expect(isSupported({ type: 'image/png', name: 'a' })).toBe(true)
    expect(isSupported({ type: 'image/jpeg', name: 'a' })).toBe(true)
  })
  it('falls back to the extension when the type is missing', () => {
    expect(isSupported({ type: '', name: 'hero@2x.PNG' })).toBe(true)
    expect(isSupported({ type: '', name: 'shot.jpeg' })).toBe(true)
  })
  it('rejects everything else', () => {
    expect(isSupported({ type: 'text/plain', name: 'notes.txt' })).toBe(false)
    expect(isSupported({ type: 'image/gif', name: 'loop.gif' })).toBe(false)
  })
})

describe('exceedsLimits', () => {
  const limits = { maxDimension: 100, maxBytes: 4 * 200 * 200 }
  it('measures the dimension cap on the 1x result, not the file', () => {
    expect(exceedsLimits(200, 100, 2, limits)).toBe(false)
    expect(exceedsLimits(202, 100, 2, limits)).toBe(true)
    expect(exceedsLimits(101, 10, 1, limits)).toBe(true)
    expect(exceedsLimits(10, 303, 3, limits)).toBe(true)
  })
  it('measures the byte cap on the decoded file', () => {
    expect(exceedsLimits(200, 200, 3, limits)).toBe(false)
    expect(exceedsLimits(201, 200, 3, limits)).toBe(true)
  })
})
