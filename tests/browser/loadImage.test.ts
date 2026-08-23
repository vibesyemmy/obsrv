import { describe, it, expect } from 'vitest'
import { loadImage } from '../../src/renderer/src/image/loadImage'

async function png(width: number, height: number, paint: (c: OffscreenCanvasRenderingContext2D) => void) {
  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d')!
  paint(ctx)
  const blob = await canvas.convertToBlob({ type: 'image/png' })
  return new File([blob], 'fixture@2x.png', { type: 'image/png' })
}

describe('loadImage', () => {
  it('downsamples a 2x export to its 1x pixels', async () => {
    const file = await png(4, 2, ctx => {
      ctx.fillStyle = '#000000'
      ctx.fillRect(0, 0, 4, 2)
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(2, 0, 2, 2)
    })

    const out = await loadImage(file, 2)

    expect(out.natural).toEqual({ width: 4, height: 2 })
    expect({ w: out.oneX.width, h: out.oneX.height }).toEqual({ w: 2, h: 1 })
    expect(Array.from(out.oneX.data.slice(0, 3))).toEqual([0, 0, 0])
    expect(Array.from(out.oneX.data.slice(4, 7))).toEqual([255, 255, 255])
    // Texture-ready BGRA with alpha forced opaque.
    expect(Array.from(out.bgra.slice(4, 8))).toEqual([255, 255, 255, 255])
  })

  it('passes a 1x export straight through', async () => {
    const file = await png(3, 3, ctx => {
      ctx.fillStyle = '#ff0000'
      ctx.fillRect(0, 0, 3, 3)
    })
    const out = await loadImage(file, 1)
    expect({ w: out.oneX.width, h: out.oneX.height }).toEqual({ w: 3, h: 3 })
  })

  it('composites transparent regions over white, not the black under alpha 0', async () => {
    // Left half untouched (alpha 0, RGB 0 in the encoded PNG); right half
    // opaque black. `rgbaToBgra` forces alpha 255, so an uncomposited
    // transparent pixel would come out as opaque black in the target texture.
    const file = await png(4, 2, ctx => {
      ctx.fillStyle = '#000000'
      ctx.fillRect(2, 0, 2, 2)
    })

    const out = await loadImage(file, 2)

    expect({ w: out.oneX.width, h: out.oneX.height }).toEqual({ w: 2, h: 1 })
    expect(Array.from(out.oneX.data.slice(0, 4))).toEqual([255, 255, 255, 255])
    expect(Array.from(out.oneX.data.slice(4, 8))).toEqual([0, 0, 0, 255])
    expect(Array.from(out.bgra.slice(0, 4))).toEqual([255, 255, 255, 255])
  })

  it('refuses an export whose 1x result would not fit the texture', async () => {
    const file = await png(8, 4, ctx => {
      ctx.fillStyle = '#00ff00'
      ctx.fillRect(0, 0, 8, 4)
    })
    await expect(loadImage(file, 2, { maxDimension: 3, maxBytes: 1 << 20 })).rejects.toThrow(
      /Image too large \(max 3×3 px at 1x, 1 MB decoded\)/,
    )
    // The same file fits once the cap admits a 4-wide 1x result.
    const out = await loadImage(file, 2, { maxDimension: 4, maxBytes: 1 << 20 })
    expect({ w: out.oneX.width, h: out.oneX.height }).toEqual({ w: 4, h: 2 })
  })

  it('refuses a file that is not a PNG or JPEG', async () => {
    const file = new File(['hello'], 'notes.txt', { type: 'text/plain' })
    await expect(loadImage(file, 2)).rejects.toThrow(/Unsupported file type/)
  })
})
