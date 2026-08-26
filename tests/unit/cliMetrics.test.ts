import { describe, it, expect } from 'vitest'
import type { RGBAImage } from '../../src/shared/downsample'
import { BAND_COUNT, FINDING_THRESHOLD, diffMetrics, inkCoverage, inkRows } from '../../src/cli/metrics'

/** Solid-white image with optional black pixels at [x, y] coordinates. */
function img(width: number, height: number, black: Array<[number, number]> = []): RGBAImage {
  const data = new Uint8ClampedArray(width * height * 4).fill(255)
  for (const [x, y] of black) {
    const i = (y * width + x) * 4
    data[i] = 0
    data[i + 1] = 0
    data[i + 2] = 0
  }
  return { width, height, data }
}

describe('inkCoverage / inkRows', () => {
  it('white has no ink; black pixels are counted as a fraction', () => {
    expect(inkCoverage(img(4, 4))).toBe(0)
    expect(inkCoverage(img(4, 4, [[0, 0], [1, 0], [2, 2], [3, 3]]))).toBeCloseTo(4 / 16)
  })
  it('mid-grey below the luminance threshold is ink, light grey is not', () => {
    const grey = (v: number): RGBAImage => {
      const one = img(1, 1)
      one.data[0] = one.data[1] = one.data[2] = v
      return one
    }
    expect(inkCoverage(grey(120))).toBe(1)
    expect(inkCoverage(grey(230))).toBe(0)
  })
  it('inkRows counts rows containing at least one ink pixel once', () => {
    expect(inkRows(img(4, 4))).toBe(0)
    expect(inkRows(img(4, 4, [[0, 1], [3, 1], [2, 3]]))).toBe(2)
  })
})

describe('diffMetrics', () => {
  it('identical images produce zero deltas and no findings', () => {
    const a = img(8, 16, [[1, 2], [5, 9]])
    const b = img(8, 16, [[1, 2], [5, 9]])
    const m = diffMetrics(a, b, 4)
    expect(m.inkCoverage.target).toBeCloseTo(2 / 128)
    expect(m.inkCoverage.reference).toBeCloseTo(2 / 128)
    expect(m.inkCoverage.delta).toBe(0)
    expect(m.rows).toEqual({ target: 2, reference: 4, ratio: 0.5 })
    expect(m.findings).toEqual([])
  })
  it('splits the height into 8 bands covering every row', () => {
    const m = diffMetrics(img(2, 16), img(2, 16), 0)
    expect(m.bands).toHaveLength(BAND_COUNT)
    expect(m.bands[0]).toMatchObject({ y0: 0, y1: 2 })
    expect(m.bands[7]).toMatchObject({ y0: 14, y1: 16 })
  })
  it('reports a finding when a band loses more ink than the threshold', () => {
    // Reference band 0 (rows 0..1 of 16) is fully black; target is white there.
    const black: Array<[number, number]> = []
    for (let y = 0; y < 2; y++) for (let x = 0; x < 8; x++) black.push([x, y])
    const m = diffMetrics(img(8, 16), img(8, 16, black), 2)
    expect(m.bands[0]!.referenceInk).toBe(1)
    expect(m.bands[0]!.targetInk).toBe(0)
    expect(m.bands[0]!.delta).toBe(-1)
    expect(m.findings).toHaveLength(1)
    expect(m.findings[0]).toMatch(/band 0/)
    expect(m.findings[0]).toMatch(/y 0–2/)
    expect(m.findings[0]).toMatch(/loses ink/)
    expect(Math.abs(m.bands[0]!.delta)).toBeGreaterThan(FINDING_THRESHOLD)
  })
  it('reports gained ink symmetrically', () => {
    const black: Array<[number, number]> = []
    for (let y = 14; y < 16; y++) for (let x = 0; x < 8; x++) black.push([x, y])
    const m = diffMetrics(img(8, 16, black), img(8, 16), 0)
    expect(m.bands[7]!.delta).toBe(1)
    expect(m.findings[0]).toMatch(/gains ink/)
  })
  it('a rowless reference yields a null ratio', () => {
    expect(diffMetrics(img(2, 8), img(2, 8), 0).rows.ratio).toBeNull()
  })
  it('rejects mismatched dimensions', () => {
    expect(() => diffMetrics(img(2, 8), img(2, 9), 0)).toThrow(/dimensions/)
  })
})

describe('diffMetrics on renders that never went paint-quiet', () => {
  // A page that keeps animating gives two captures of *different frames*, so
  // any band delta is frame-to-frame noise, not evidence about rasterisation.
  const target = img(8, 16, Array.from({ length: 8 }, (_, x) => [x, 4] as [number, number]))
  const reference = img(8, 16)

  it('reports settled, defaulting to true so existing callers are unchanged', () => {
    expect(diffMetrics(target, reference, 4).settled).toBe(true)
    expect(diffMetrics(target, reference, 4, true).settled).toBe(true)
    expect(diffMetrics(target, reference, 4, false).settled).toBe(false)
  })

  it('keeps the raw numbers when unsettled — measurements are still measurements', () => {
    const quiet = diffMetrics(target, reference, 4, true)
    const noisy = diffMetrics(target, reference, 4, false)
    expect(noisy.inkCoverage).toEqual(quiet.inkCoverage)
    expect(noisy.rows).toEqual(quiet.rows)
    expect(noisy.bands).toEqual(quiet.bands)
  })

  it('replaces the band findings with one honest statement', () => {
    const quiet = diffMetrics(target, reference, 4, true)
    // The fixture is chosen to trip at least one band finding when settled.
    expect(quiet.findings.length).toBeGreaterThan(0)
    expect(quiet.findings.some(f => f.startsWith('band '))).toBe(true)

    const noisy = diffMetrics(target, reference, 4, false)
    expect(noisy.findings).toHaveLength(1)
    expect(noisy.findings[0]).toMatch(/did not go paint-quiet/)
    // No band claim survives: "strokes thickening" would be a false assertion.
    expect(noisy.findings.some(f => f.startsWith('band '))).toBe(false)
  })
})
