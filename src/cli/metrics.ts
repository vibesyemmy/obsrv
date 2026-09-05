import type { RGBAImage } from '../shared/downsample'

/**
 * Ink metrics for `obsrv diff`, lifted from the proven math in
 * `tests/e2e/rendering.spec.ts`: a pixel is "ink" when its Rec. 709 luminance
 * falls below 200 (same threshold as the spec's inkRows), and rows/coverage
 * are counted rather than guessed at.
 *
 * The metrics are deliberately honest about what the math supports. A 0.5px
 * hairline renders one device row at 1x *and* at 2x (rendering.spec.ts), so
 * "the hairline vanished" is not a claim these numbers can make. What they can
 * show: ink-coverage deltas (thinning / darkening) and row-count ratios (a
 * glyph's rows scale with the raster — a hairline's do not).
 */

export const INK_LUMINANCE = 200
export const BAND_COUNT = 8
/** A band's |ink delta| (fraction of band pixels) above this becomes a finding. */
export const FINDING_THRESHOLD = 0.005

export function luminance(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

const isInk = (d: Uint8ClampedArray, i: number): boolean => luminance(d[i]!, d[i + 1]!, d[i + 2]!) < INK_LUMINANCE

/** Fraction of pixels darker than the ink threshold. */
export function inkCoverage(img: RGBAImage): number {
  let ink = 0
  for (let i = 0; i < img.data.length; i += 4) {
    if (isInk(img.data, i)) ink++
  }
  return ink / (img.width * img.height)
}

/** Rows containing at least one ink pixel. */
export function inkRows(img: RGBAImage): number {
  let rows = 0
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (isInk(img.data, (y * img.width + x) * 4)) {
        rows++
        break
      }
    }
  }
  return rows
}

export interface Band {
  /** Row range on the target's 1x grid; y1 is exclusive. */
  y0: number
  y1: number
  /** Ink fraction of the band's pixels. */
  targetInk: number
  referenceInk: number
  delta: number
}

/**
 * What a diff says when the renders never went paint-quiet. The bands are
 * still reported — a measurement is a measurement — but the band *findings*
 * are claims about rasterisation, and two captures of different animation
 * frames cannot support one.
 */
export const UNSETTLED_FINDING =
  'renders did not go paint-quiet (animation or video, or a load that never finished), so the two captures are ' +
  'different frames — the band deltas below are frame-to-frame noise, not evidence about rasterisation. ' +
  'Compare a static page, or pass a longer --timeout if the page merely settles late.'

export interface DiffMetrics {
  /**
   * False when either render was a best-effort capture of a page that kept
   * painting. Callers must not read the band deltas as rendering evidence.
   */
  settled: boolean
  inkCoverage: { target: number; reference: number; delta: number }
  rows: {
    /** Ink rows in the 1x target raster. */
    target: number
    /** Ink rows in the raw 2x reference raster (device rows, before downsampling). */
    reference: number
    /** target / reference — ≈0.5 for content that scales with the raster; null when the reference has none. */
    ratio: number | null
  }
  bands: Band[]
  findings: string[]
}

function bandInk(img: RGBAImage, y0: number, y1: number): number {
  let ink = 0
  for (let y = y0; y < y1; y++) {
    for (let x = 0; x < img.width; x++) {
      if (isInk(img.data, (y * img.width + x) * 4)) ink++
    }
  }
  const pixels = (y1 - y0) * img.width
  return pixels === 0 ? 0 : ink / pixels
}

const pct = (v: number): string => `${(v * 100).toFixed(2)}%`

/**
 * Compares the target render against the reference on the *same* 1x grid
 * (`reference` is the 2x render box-downsampled by 2). `referenceDeviceRows`
 * is the ink-row count of the raw 2x raster, so `rows.ratio` reproduces the
 * 2:1 device-row finding of rendering.spec.ts instead of comparing a raster
 * to its own resample.
 *
 * `settled` is the AND of both captures' quiescence. When false the numbers
 * are still returned and the interpretation is withheld — see
 * `UNSETTLED_FINDING`.
 */
export function diffMetrics(
  target: RGBAImage,
  reference: RGBAImage,
  referenceDeviceRows: number,
  settled = true,
): DiffMetrics {
  if (target.width !== reference.width || target.height !== reference.height) {
    throw new RangeError(
      `diffMetrics: mismatched dimensions (target ${target.width}x${target.height}, reference ${reference.width}x${reference.height})`,
    )
  }

  const targetCoverage = inkCoverage(target)
  const referenceCoverage = inkCoverage(reference)
  const targetRows = inkRows(target)

  const bands: Band[] = []
  const findings: string[] = []
  for (let i = 0; i < BAND_COUNT; i++) {
    const y0 = Math.floor((target.height * i) / BAND_COUNT)
    const y1 = Math.floor((target.height * (i + 1)) / BAND_COUNT)
    const targetInk = bandInk(target, y0, y1)
    const referenceInk = bandInk(reference, y0, y1)
    const delta = targetInk - referenceInk
    bands.push({ y0, y1, targetInk, referenceInk, delta })
    if (Math.abs(delta) > FINDING_THRESHOLD) {
      const direction = delta < 0
        ? 'target loses ink vs the 2x reference (thin strokes weakening or dropping out)'
        : 'target gains ink vs the 2x reference (strokes thickening or darkening)'
      findings.push(
        `band ${i} (y ${y0}–${y1}): ink ${pct(targetInk)} vs ${pct(referenceInk)} reference ` +
          `(${delta >= 0 ? '+' : ''}${(delta * 100).toFixed(2)}pp) — ${direction}`,
      )
    }
  }

  return {
    settled,
    inkCoverage: { target: targetCoverage, reference: referenceCoverage, delta: targetCoverage - referenceCoverage },
    rows: {
      target: targetRows,
      reference: referenceDeviceRows,
      ratio: referenceDeviceRows > 0 ? targetRows / referenceDeviceRows : null,
    },
    bands,
    findings: settled ? findings : [UNSETTLED_FINDING],
  }
}
