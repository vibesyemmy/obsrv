export interface RGBAImage {
  width: number
  height: number
  /** RGBA, row-major, no padding */
  data: Uint8ClampedArray
}

/** Area-average downsample by an integer factor. Partial edge blocks are dropped. */
export function boxDownsample(src: RGBAImage, factor: number): RGBAImage {
  if (!Number.isInteger(factor) || factor < 1) throw new RangeError('factor must be an integer >= 1')
  if (factor === 1) return { width: src.width, height: src.height, data: new Uint8ClampedArray(src.data) }
  const width = Math.floor(src.width / factor)
  const height = Math.floor(src.height / factor)
  const data = new Uint8ClampedArray(width * height * 4)
  const n = factor * factor
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0, a = 0
      for (let dy = 0; dy < factor; dy++) {
        let i = ((y * factor + dy) * src.width + x * factor) * 4
        for (let dx = 0; dx < factor; dx++, i += 4) {
          r += src.data[i]!; g += src.data[i + 1]!; b += src.data[i + 2]!; a += src.data[i + 3]!
        }
      }
      const o = (y * width + x) * 4
      data[o] = Math.round(r / n); data[o + 1] = Math.round(g / n); data[o + 2] = Math.round(b / n); data[o + 3] = Math.round(a / n)
    }
  }
  return { width, height, data }
}

/** Convert to the BGRA layout the target texture uses (alpha forced opaque). */
/**
 * A rectangular region of an image, copied out. The rect is in the source's
 * own pixels; it is clamped to the image, so an out-of-bounds or oversized
 * rect yields whatever overlaps (empty when there is no overlap). Row-major
 * RGBA in, row-major RGBA out — no scaling, the actual pixels.
 */
export function cropImage(src: RGBAImage, x: number, y: number, w: number, h: number): RGBAImage {
  const x0 = Math.max(0, Math.min(src.width, Math.round(x)))
  const y0 = Math.max(0, Math.min(src.height, Math.round(y)))
  const x1 = Math.max(x0, Math.min(src.width, Math.round(x + w)))
  const y1 = Math.max(y0, Math.min(src.height, Math.round(y + h)))
  const cw = x1 - x0
  const ch = y1 - y0
  const out = new Uint8ClampedArray(cw * ch * 4)
  for (let row = 0; row < ch; row++) {
    const srcStart = ((y0 + row) * src.width + x0) * 4
    out.set(src.data.subarray(srcStart, srcStart + cw * 4), row * cw * 4)
  }
  return { width: cw, height: ch, data: out }
}

export function rgbaToBgra(src: RGBAImage): Uint8Array {
  const out = new Uint8Array(src.data.length)
  for (let i = 0; i < src.data.length; i += 4) {
    out[i] = src.data[i + 2]!; out[i + 1] = src.data[i + 1]!; out[i + 2] = src.data[i]!; out[i + 3] = 255
  }
  return out
}
