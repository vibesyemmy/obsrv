import { describe, expect, it } from 'vitest'
import { formatOnionSkin, isOnionSkin, ONION_STEPS, parseOnionSkin, REFERENCE_DSF, referenceFits } from '../../src/shared/onionSkin'

describe('onion skin values', () => {
  it('offers off and four steps, and accepts any opacity in between', () => {
    expect(ONION_STEPS).toEqual([0, 0.25, 0.5, 0.75, 1])
    expect(isOnionSkin(0)).toBe(true)
    expect(isOnionSkin(0.37)).toBe(true)
    expect(isOnionSkin(1)).toBe(true)
    expect(isOnionSkin(1.01)).toBe(false)
    expect(isOnionSkin(-0.1)).toBe(false)
    expect(isOnionSkin('0.5')).toBe(false)
    expect(isOnionSkin(NaN)).toBe(false)
  })
  it('parses the wire value or refuses it', () => {
    expect(parseOnionSkin(0.5)).toBe(0.5)
    expect(parseOnionSkin(2)).toBeNull()
    expect(parseOnionSkin(undefined)).toBeNull()
  })
  it('formats off and percentages', () => {
    expect(formatOnionSkin(0)).toBe('off')
    expect(formatOnionSkin(0.5)).toBe('50%')
    expect(formatOnionSkin(0.333)).toBe('33%')
    expect(formatOnionSkin(1)).toBe('100%')
  })
})

describe('referenceFits', () => {
  it('doubles the CSS viewport against the device-pixel budget', () => {
    expect(REFERENCE_DSF).toBe(2)
    expect(referenceFits(1920, 1080, 4096)).toBe(true)
    expect(referenceFits(2048, 1152, 4096)).toBe(true)
    expect(referenceFits(2560, 1440, 4096)).toBe(false)
    expect(referenceFits(1366, 2100, 4096)).toBe(false)
  })
})
