import { describe, expect, it } from 'vitest'
import { clipToExtent, paintedExtent } from '../../src/shared/paint'

describe('paintedExtent', () => {
  it('is the bitmap when the product is whole', () => {
    expect(paintedExtent({ width: 1920, height: 1080 }, { width: 1536, height: 864 }, 1.25)).toEqual({ width: 1920, height: 1080 })
    expect(paintedExtent({ width: 1179, height: 2556 }, { width: 393, height: 852 }, 3)).toEqual({ width: 1179, height: 2556 })
  })
  it('is the floor of a fractional product when the bitmap is its rounding', () => {
    // The Pixel: 412 × 2.625 = 1081.5, 915 × 2.625 = 2401.875; Electron allocates 1082×2402.
    expect(paintedExtent({ width: 1082, height: 2402 }, { width: 412, height: 915 }, 2.625)).toEqual({ width: 1081, height: 2401 })
  })
  it('leaves a bitmap of another size whole: a frame painted against a previous viewport', () => {
    expect(paintedExtent({ width: 1920, height: 1080 }, { width: 412, height: 915 }, 2.625)).toEqual({ width: 1920, height: 1080 })
  })
  it('absorbs float noise in a decimal-whole product', () => {
    expect(paintedExtent({ width: 1920, height: 1200 }, { width: 1280, height: 800 }, 1.5)).toEqual({ width: 1920, height: 1200 })
  })
})

describe('clipToExtent', () => {
  const extent = { width: 1081, height: 2401 }
  it('cuts a slice that overhangs the sliver', () => {
    expect(clipToExtent({ x: 1000, y: 2300, width: 82, height: 102 }, extent)).toEqual({ x: 1000, y: 2300, width: 81, height: 101 })
  })
  it('leaves a slice inside alone and drops one wholly in the sliver', () => {
    expect(clipToExtent({ x: 10, y: 10, width: 100, height: 100 }, extent)).toEqual({ x: 10, y: 10, width: 100, height: 100 })
    expect(clipToExtent({ x: 1081, y: 0, width: 1, height: 2402 }, extent)).toBeNull()
    expect(clipToExtent({ x: 0, y: 2401, width: 1082, height: 1 }, extent)).toBeNull()
  })
})
