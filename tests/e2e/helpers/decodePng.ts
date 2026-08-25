import { inflateSync } from 'node:zlib'

/**
 * Minimal, dependency-free PNG decoder for the CLI e2e specs. Deliberately
 * independent of Electron's nativeImage: the CLI *encodes* through
 * nativeImage, so decoding through it again would hide a swapped channel
 * order (BGRA written as RGBA would round-trip cleanly). zlib + the PNG
 * filter spec are the ground truth instead.
 *
 * Supports what Electron's `toPNG()` emits (and nothing more): 8-bit,
 * truecolour with or without alpha, non-interlaced.
 */
export interface DecodedPng {
  width: number
  height: number
  /** RGBA, row-major, no padding. */
  data: Uint8Array
}

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10]

export function decodePng(buf: Buffer): DecodedPng {
  for (let i = 0; i < SIGNATURE.length; i++) {
    if (buf[i] !== SIGNATURE[i]) throw new Error('not a PNG')
  }
  let pos = 8
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  const idat: Buffer[] = []
  while (pos + 8 <= buf.length) {
    const length = buf.readUInt32BE(pos)
    const type = buf.toString('ascii', pos + 4, pos + 8)
    const chunk = buf.subarray(pos + 8, pos + 8 + length)
    if (type === 'IHDR') {
      width = chunk.readUInt32BE(0)
      height = chunk.readUInt32BE(4)
      bitDepth = chunk[8]!
      colorType = chunk[9]!
      if (chunk[12] !== 0) throw new Error('interlaced PNG unsupported')
    } else if (type === 'IDAT') {
      idat.push(chunk)
    } else if (type === 'IEND') {
      break
    }
    pos += 12 + length
  }
  if (bitDepth !== 8 || (colorType !== 6 && colorType !== 2)) {
    throw new Error(`unsupported PNG format: bit depth ${bitDepth}, colour type ${colorType}`)
  }
  const bpp = colorType === 6 ? 4 : 3
  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * bpp
  const out = new Uint8Array(width * height * 4)
  const prev = new Uint8Array(stride)
  const cur = new Uint8Array(stride)
  let p = 0
  for (let y = 0; y < height; y++) {
    const filter = raw[p++]!
    for (let x = 0; x < stride; x++) {
      const rawByte = raw[p + x]!
      const a = x >= bpp ? cur[x - bpp]! : 0
      const b = prev[x]!
      const c = x >= bpp ? prev[x - bpp]! : 0
      let v: number
      switch (filter) {
        case 0:
          v = rawByte
          break
        case 1:
          v = rawByte + a
          break
        case 2:
          v = rawByte + b
          break
        case 3:
          v = rawByte + ((a + b) >> 1)
          break
        case 4: {
          const pa = Math.abs(b - c)
          const pb = Math.abs(a - c)
          const pc = Math.abs(a + b - 2 * c)
          v = rawByte + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)
          break
        }
        default:
          throw new Error(`unknown PNG filter ${filter}`)
      }
      cur[x] = v & 255
    }
    p += stride
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4
      const s = x * bpp
      out[o] = cur[s]!
      out[o + 1] = cur[s + 1]!
      out[o + 2] = cur[s + 2]!
      out[o + 3] = colorType === 6 ? cur[s + 3]! : 255
    }
    prev.set(cur)
  }
  return { width, height, data: out }
}

/** RGBA of the pixel at (x, y). */
export function pixelAt(png: DecodedPng, x: number, y: number): [number, number, number, number] {
  const i = (y * png.width + x) * 4
  return [png.data[i]!, png.data[i + 1]!, png.data[i + 2]!, png.data[i + 3]!]
}
