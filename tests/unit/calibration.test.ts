import { describe, it, expect } from 'vitest'
import { ppi, computeScale, clampViewport } from '../../src/shared/calibration'

const host4k27 = { physicalWidth: 3840, physicalHeight: 2160, diagonalInches: 27, scaleFactor: 2 }

describe('ppi', () => {
  it('computes pixels per inch from diagonal', () => {
    expect(ppi(1920, 1080, 24)).toBeCloseTo(91.79, 2)
    expect(ppi(3840, 2160, 27)).toBeCloseTo(163.18, 2)
  })
  it('rejects non-positive diagonal', () => {
    expect(() => ppi(1920, 1080, 0)).toThrow(RangeError)
  })
})

describe('computeScale', () => {
  it('is exactly 2 for 1080p 27" on a 4K 27" host', () => {
    expect(computeScale(host4k27, { width: 1920, height: 1080, diagonalInches: 27 }, false)).toBeCloseTo(2, 10)
  })
  it('is 16/9 for 1080p 24" on a 4K 27" host', () => {
    expect(computeScale(host4k27, { width: 1920, height: 1080, diagonalInches: 24 }, false)).toBeCloseTo(16 / 9, 6)
  })
  it('pixel-exact returns host scale factor', () => {
    expect(computeScale(host4k27, { width: 1920, height: 1080, diagonalInches: 24 }, true)).toBe(2)
    expect(computeScale({ ...host4k27, scaleFactor: 1 }, { width: 1920, height: 1080, diagonalInches: 24 }, true)).toBe(1)
  })
})

describe('clampViewport', () => {
  it('passes through sizes within the limit', () => {
    expect(clampViewport(1920, 1080)).toEqual({ width: 1920, height: 1080, clamped: false })
  })
  it('clamps each axis to MAX_VIEWPORT and flags it', () => {
    expect(clampViewport(5000, 1000)).toEqual({ width: 4096, height: 1000, clamped: true })
  })
  it('floors to integers and enforces a minimum of 1', () => {
    expect(clampViewport(100.7, 0)).toEqual({ width: 100, height: 1, clamped: true })
  })
})
