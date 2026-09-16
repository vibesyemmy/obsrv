import { describe, expect, it } from 'vitest'
import { formatOnionSkin, isOnionSkin, ONION_STEPS, onionSkinRefusal, parseOnionSkin, REFERENCE_DSF, referenceFits } from '../../src/shared/onionSkin'

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

describe('onionSkinRefusal', () => {
  it('is null exactly where a reference fits, and a sentence everywhere else', () => {
    const sides = [1, 1366, 2047, 2048, 2049, 2160, 3440, 3840]
    let refused = 0
    for (const w of sides) {
      for (const h of sides) {
        const note = onionSkinRefusal(w, h, 4096)
        expect(note === null, `${w}x${h}`).toBe(referenceFits(w, h, 4096))
        if (note !== null) refused++
      }
    }
    // Both answers occur, so the agreement is not two functions that always say the same thing.
    expect(refused).toBeGreaterThan(0)
    expect(refused).toBeLessThan(sides.length * sides.length)
  })

  it('names the viewport, the render it would need, the limit, and the largest screen that can have one', () => {
    const note = onionSkinRefusal(3440, 1440, 4096)!
    expect(note).toContain('the onion skin was left off')
    expect(note).toContain('3440x1440 viewport')
    expect(note).toContain('6880x2880 device px')
    expect(note).toContain('past the 4096 px limit')
    expect(note).toContain('up to 2048 CSS px on each side')
    // One side past the limit is enough.
    expect(onionSkinRefusal(1080, 2400, 4096)).toContain('1080x2400 viewport')
  })
})
