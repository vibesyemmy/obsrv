import { boxDownsample, rgbaToBgra, type RGBAImage } from '../../../shared/downsample'

const SUPPORTED_TYPES = ['image/png', 'image/jpeg']
const SUPPORTED_EXTENSIONS = /\.(png|jpe?g)$/i

export class UnsupportedFileError extends Error {
  constructor(what: string) {
    super(`Unsupported file type: ${what || 'unknown'}`)
    this.name = 'UnsupportedFileError'
  }
}

/** Some drops arrive with an empty MIME type, so the extension is the fallback. */
export function isSupported(file: { type: string; name: string }): boolean {
  return SUPPORTED_TYPES.includes(file.type) || SUPPORTED_EXTENSIONS.test(file.name)
}

export interface LoadedImage {
  /** The file's own pixel dimensions, for the left pane. */
  natural: { width: number; height: number }
  /** Downsampled to 1x by the export factor. */
  oneX: RGBAImage
  /** `oneX` in the BGRA layout the target texture expects. */
  bgra: Uint8Array
  /** For the `<img>` in the left pane; revoke it when replaced. */
  objectUrl: string
}

/**
 * Decodes a design export and recovers its 1x pixels.
 *
 * Downsampling a 2x export is not the same as a rasteriser drawing the design
 * at 1x — real 1x text uses hinting and greyscale AA at that size. It is
 * accurate for geometry and colour (hairlines, stroke weight, contrast,
 * banding, gamut) and approximate for type. Exporting at 1x from the design
 * tool and choosing "1×" here routes that tool's own 1x rasteriser through the
 * physical-size and panel-simulation path instead.
 */
export async function loadImage(file: File, exportScale: number): Promise<LoadedImage> {
  if (!isSupported(file)) throw new UnsupportedFileError(file.type || file.name)

  const bitmap = await createImageBitmap(file)
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('2D canvas unavailable')
  // Composite over white first: transparent PNG regions must read as page background,
  // not as the black RGB that usually sits under alpha 0. Keeps alpha at 255 downstream.
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, bitmap.width, bitmap.height)
  ctx.drawImage(bitmap, 0, 0)
  const raw = ctx.getImageData(0, 0, bitmap.width, bitmap.height)
  bitmap.close()

  const src: RGBAImage = { width: raw.width, height: raw.height, data: raw.data }
  const oneX = boxDownsample(src, exportScale)

  return {
    natural: { width: raw.width, height: raw.height },
    oneX,
    bgra: rgbaToBgra(oneX),
    objectUrl: URL.createObjectURL(file),
  }
}
