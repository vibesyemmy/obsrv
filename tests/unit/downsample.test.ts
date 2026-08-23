import { describe, it, expect } from 'vitest'
import { boxDownsample, rgbaToBgra, type RGBAImage } from '../../src/shared/downsample'

function img(width: number, height: number, px: number[][]): RGBAImage {
  const data = new Uint8ClampedArray(width * height * 4)
  px.forEach((p, i) => data.set(p, i * 4))
  return { width, height, data }
}

describe('boxDownsample', () => {
  it('factor 1 copies', () => {
    const src = img(1, 1, [[1, 2, 3, 255]])
    const out = boxDownsample(src, 1)
    expect(out).toEqual(src)
    expect(out.data).not.toBe(src.data)
  })
  it('factor 2 averages 2x2 blocks', () => {
    const src = img(2, 2, [[255, 0, 0, 255], [0, 0, 255, 255], [0, 0, 0, 255], [0, 0, 0, 255]])
    const out = boxDownsample(src, 2)
    expect(out.width).toBe(1)
    expect(out.height).toBe(1)
    expect(Array.from(out.data)).toEqual([64, 0, 64, 255])
  })
  it('drops partial edge blocks', () => {
    const src = img(3, 3, Array(9).fill([10, 10, 10, 255]))
    const out = boxDownsample(src, 2)
    expect([out.width, out.height]).toEqual([1, 1])
  })
  it('rejects non-integer or < 1 factors', () => {
    const src = img(1, 1, [[0, 0, 0, 255]])
    expect(() => boxDownsample(src, 1.5)).toThrow(RangeError)
    expect(() => boxDownsample(src, 0)).toThrow(RangeError)
  })
})

describe('rgbaToBgra', () => {
  it('swaps R and B and forces alpha 255', () => {
    const out = rgbaToBgra(img(1, 1, [[1, 2, 3, 9]]))
    expect(Array.from(out)).toEqual([3, 2, 1, 255])
  })
})
