import { describe, it, expect } from 'vitest'
import { boxDownsample, cropImage, rgbaToBgra, type RGBAImage } from '../../src/shared/downsample'

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

describe('cropImage', () => {
  // A 3x2 image: top row 1,2,3; bottom row 4,5,6 (R channel = the label).
  const src = img(3, 2, [
    [1, 0, 0, 255], [2, 0, 0, 255], [3, 0, 0, 255],
    [4, 0, 0, 255], [5, 0, 0, 255], [6, 0, 0, 255],
  ])
  const reds = (i: RGBAImage): number[] => Array.from({ length: i.width * i.height }, (_, k) => i.data[k * 4]!)

  it('copies an interior rectangle at the source pixels', () => {
    const c = cropImage(src, 1, 0, 2, 2)
    expect([c.width, c.height]).toEqual([2, 2])
    expect(reds(c)).toEqual([2, 3, 5, 6])
  })
  it('clamps a rect that runs past the edges', () => {
    const c = cropImage(src, 2, 1, 10, 10)
    expect([c.width, c.height]).toEqual([1, 1])
    expect(reds(c)).toEqual([6])
  })
  it('a rect straddling the top-left keeps only the part over the image', () => {
    const c = cropImage(src, -1, -1, 3, 3)
    expect([c.width, c.height]).toEqual([2, 2])
    expect(reds(c)).toEqual([1, 2, 4, 5])
  })
  it('no overlap yields an empty image', () => {
    const c = cropImage(src, 100, 100, 10, 10)
    expect([c.width, c.height]).toEqual([0, 0])
  })
})
