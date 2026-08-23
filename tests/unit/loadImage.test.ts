import { describe, it, expect } from 'vitest'
import { isSupported } from '../../src/renderer/src/image/loadImage'

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
