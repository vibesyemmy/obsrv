import { describe, it, expect } from 'vitest'
import { ppi, computeScale, clampViewport, maxCssViewport, applyOrientation, screenShape } from '../../src/shared/calibration'

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
  it('scales per device pixel: an iPhone 6.1" 3x target is ~460 PPI', () => {
    // 393x852 CSS at 3x = 1179x2556 device pixels over 6.1" -> 461.4 PPI.
    const iphone = { width: 393, height: 852, diagonalInches: 6.1, deviceScaleFactor: 3 }
    const host138 = { physicalWidth: 3024, physicalHeight: 1964, diagonalInches: 26.1, scaleFactor: 2 }
    // A ~138 PPI host shows each iPhone device pixel at ~0.30 host pixels.
    expect(ppi(host138.physicalWidth, host138.physicalHeight, host138.diagonalInches)).toBeCloseTo(138.15, 1)
    expect(computeScale(host138, iphone, false)).toBeCloseTo(0.299, 2)
    // Without the dsf the same screen would (wrongly) read as ~154 PPI.
    expect(computeScale(host4k27, iphone, false)).toBeCloseTo(163.18 / 461.4, 3)
  })
  it('deviceScaleFactor defaults to 1 for existing call sites', () => {
    const plain = computeScale(host4k27, { width: 1920, height: 1080, diagonalInches: 27 }, false)
    const explicit = computeScale(host4k27, { width: 1920, height: 1080, diagonalInches: 27, deviceScaleFactor: 1 }, false)
    expect(plain).toBe(explicit)
  })
  it('pixel-exact returns host scale factor', () => {
    expect(computeScale(host4k27, { width: 1920, height: 1080, diagonalInches: 24 }, true)).toBe(2)
    expect(computeScale({ ...host4k27, scaleFactor: 1 }, { width: 1920, height: 1080, diagonalInches: 24 }, true)).toBe(1)
    // Unchanged semantics on a mobile target: device pixels shown 1:1.
    expect(computeScale(host4k27, { width: 393, height: 852, diagonalInches: 6.1, deviceScaleFactor: 3 }, true)).toBe(2)
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
  it('replaces NaN/Infinity with 1 and flags it', () => {
    expect(clampViewport(NaN, Infinity)).toEqual({ width: 1, height: 1, clamped: true })
  })
})

describe('maxCssViewport', () => {
  it('is the full limit at 1x and shrinks with the device scale factor', () => {
    expect(maxCssViewport(1)).toBe(4096)
    expect(maxCssViewport(2)).toBe(2048)
    expect(maxCssViewport(3)).toBe(1365)
  })
  it('lets 393x852 at 3x through as 1179x2556 device pixels', () => {
    const v = clampViewport(393, 852, maxCssViewport(3))
    expect(v).toEqual({ width: 393, height: 852, clamped: false })
  })
  it('treats a bad factor as 1', () => {
    expect(maxCssViewport(0)).toBe(4096)
    expect(maxCssViewport(NaN)).toBe(4096)
  })
})

describe('applyOrientation', () => {
  const iphone = { width: 393, height: 852, diagonalInches: 6.1, deviceScaleFactor: 3 }

  it('leaves the preset alone in portrait', () => {
    expect(applyOrientation(iphone, 'portrait')).toEqual(iphone)
  })

  it('swaps the CSS axes in landscape and touches nothing else', () => {
    expect(applyOrientation(iphone, 'landscape')).toEqual({
      width: 852,
      height: 393,
      diagonalInches: 6.1,
      deviceScaleFactor: 3,
    })
  })

  it('is its own inverse', () => {
    expect(applyOrientation(applyOrientation(iphone, 'landscape'), 'landscape')).toEqual(iphone)
  })

  it('does not mutate its argument', () => {
    const before = { ...iphone }
    applyOrientation(iphone, 'landscape')
    expect(iphone).toEqual(before)
  })

  it('preserves extra fields a caller carries', () => {
    const withExtra = { ...iphone, label: 'iPhone 6.1" @3x' }
    expect(applyOrientation(withExtra, 'landscape').label).toBe('iPhone 6.1" @3x')
  })

  // The invariant the whole feature rests on: a phone does not become
  // physically bigger or denser by being turned sideways. `ppi` is
  // hypot(w, h) / diagonal and hypot is symmetric, so the diagonal, the pixel
  // count and therefore the magnification are all orientation-independent.
  it('leaves physical scale, pixel count and ppi unchanged in magnitude', () => {
    const host = { physicalWidth: 3024, physicalHeight: 1964, diagonalInches: 26.1, scaleFactor: 2 }
    for (const screen of [
      iphone,
      { width: 360, height: 800, diagonalInches: 6.5, deviceScaleFactor: 2 },
      { width: 1920, height: 1080, diagonalInches: 24, deviceScaleFactor: 1 },
      { width: 1366, height: 768, diagonalInches: 15.6, deviceScaleFactor: 1 },
    ]) {
      const rotated = applyOrientation(screen, 'landscape')
      const dsf = screen.deviceScaleFactor
      expect(ppi(rotated.width * dsf, rotated.height * dsf, rotated.diagonalInches)).toBeCloseTo(
        ppi(screen.width * dsf, screen.height * dsf, screen.diagonalInches),
        10,
      )
      expect(rotated.width * rotated.height).toBe(screen.width * screen.height)
      expect(rotated.diagonalInches).toBe(screen.diagonalInches)
      expect(rotated.deviceScaleFactor).toBe(screen.deviceScaleFactor)
      expect(computeScale(host, rotated, false)).toBeCloseTo(computeScale(host, screen, false), 10)
      expect(computeScale(host, rotated, true)).toBe(computeScale(host, screen, true))
    }
  })
})

describe('screenShape', () => {
  it('names the shape the dimensions actually have', () => {
    expect(screenShape(852, 393)).toBe('landscape')
    expect(screenShape(393, 852)).toBe('portrait')
    expect(screenShape(1920, 1080)).toBe('landscape')
  })
  it('counts a square screen as portrait', () => {
    expect(screenShape(800, 800)).toBe('portrait')
  })
})
