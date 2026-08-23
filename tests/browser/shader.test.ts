import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { GlRenderer } from '../../src/renderer/src/gl/renderer'
import { profileToParams, simulatePixel } from '../../src/shared/panelSim'
import { PANEL_PROFILES } from '../../src/shared/presets'
import type { FrameSlice } from '../../src/shared/types'

const W = 64
const H = 64
const HOST_NITS = 500
const REFERENCE = profileToParams(PANEL_PROFILES[0]!, HOST_NITS)

/** Sweep of the colour cube: red across, green down, blue on the diagonal. */
function gradient(): { rgb: Uint8Array; slice: FrameSlice } {
  const rgb = new Uint8Array(W * H * 3)
  const bgra = new Uint8Array(W * H * 4)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x
      const r = Math.round((x / (W - 1)) * 255)
      const g = Math.round((y / (H - 1)) * 255)
      const b = Math.round((((x + y) % W) / (W - 1)) * 255)
      rgb[i * 3] = r
      rgb[i * 3 + 1] = g
      rgb[i * 3 + 2] = b
      bgra[i * 4] = b
      bgra[i * 4 + 1] = g
      bgra[i * 4 + 2] = r
      bgra[i * 4 + 3] = 255
    }
  }
  return { rgb, slice: { x: 0, y: 0, width: W, height: H, data: bgra } }
}

describe('panel shader matches the TS reference', () => {
  const { rgb, slice } = gradient()
  let canvas: HTMLCanvasElement
  let renderer: GlRenderer

  beforeAll(() => {
    canvas = document.createElement('canvas')
    // Which GL backend ran the parity check (SwiftShader in headless CI, a real
    // GPU on a dev box); it shows up in the run log once.
    const gl = canvas.getContext('webgl2')
    const info = gl?.getExtension('WEBGL_debug_renderer_info')
    console.log(
      'WebGL2 renderer:',
      gl && info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : 'unknown',
    )
    renderer = new GlRenderer(canvas, { preserveDrawingBuffer: true })
    renderer.resizeSource(W, H)
    renderer.uploadSlice(slice)
  })
  afterAll(() => renderer.dispose())

  for (const profile of PANEL_PROFILES) {
    it(`matches simulatePixel for the ${profile.id} profile`, () => {
      const params = profileToParams(profile, HOST_NITS)
      renderer.draw({ scale: 1, params })
      const out = renderer.readPixels()

      let worst = 0
      let mismatches = 0
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const i = y * W + x
          const want = simulatePixel([rgb[i * 3]!, rgb[i * 3 + 1]!, rgb[i * 3 + 2]!], params, x, y)
          for (let c = 0; c < 3; c++) {
            const diff = Math.abs(out[i * 4 + c]! - want[c]!)
            if (diff > 0) mismatches++
            if (diff > worst) worst = diff
          }
        }
      }

      // GLSL runs in 32-bit float and the reference in 64-bit, so a value
      // sitting on a `floor(v * levels + …)` boundary can land either side.
      // That is worth one quantisation level, and only for a few samples.
      expect(worst).toBeLessThanOrEqual(Math.ceil(255 / params.levels))
      expect(mismatches / (W * H * 3)).toBeLessThan(0.01)
    })
  }
})

describe('GlRenderer', () => {
  it('upscales with nearest neighbour, not interpolation', () => {
    const renderer = new GlRenderer(document.createElement('canvas'), {
      preserveDrawingBuffer: true,
    })
    renderer.resizeSource(2, 1)
    // BGRA: black pixel then white pixel.
    renderer.uploadSlice({
      x: 0,
      y: 0,
      width: 2,
      height: 1,
      data: new Uint8Array([0, 0, 0, 255, 255, 255, 255, 255]),
    })
    renderer.draw({ scale: 4, params: REFERENCE })

    const out = renderer.readPixels() // 8x4 RGBA, top-down
    const red = (x: number, y: number): number => out[(y * 8 + x) * 4]!

    expect([red(0, 0), red(3, 0), red(4, 0), red(7, 0)]).toEqual([0, 0, 255, 255])
    // A hard seam on every row: no blend anywhere between the two source pixels.
    expect([red(3, 3), red(4, 3)]).toEqual([0, 255])
    renderer.dispose()
  })

  it('uploads a dirty rect without disturbing the rest of the texture', () => {
    const renderer = new GlRenderer(document.createElement('canvas'), {
      preserveDrawingBuffer: true,
    })
    renderer.resizeSource(4, 1)
    renderer.uploadSlice({ x: 0, y: 0, width: 4, height: 1, data: new Uint8Array(16) })
    // One red pixel at x = 2, as a 1x1 dirty rect.
    renderer.uploadSlice({
      x: 2,
      y: 0,
      width: 1,
      height: 1,
      data: new Uint8Array([0, 0, 255, 255]),
    })
    renderer.draw({ scale: 1, params: REFERENCE })

    const out = renderer.readPixels()
    expect([out[0], out[4], out[8], out[12]]).toEqual([0, 0, 255, 0])
    renderer.dispose()
  })

  it('drops a slice that does not fit the texture instead of throwing', () => {
    const renderer = new GlRenderer(document.createElement('canvas'), {
      preserveDrawingBuffer: true,
    })
    // A frame painted for an old 4x1 viewport arrives after the source shrank to 2x1.
    renderer.resizeSource(4, 1)
    renderer.uploadSlice({ x: 0, y: 0, width: 4, height: 1, data: new Uint8Array(16) })
    renderer.resizeSource(2, 1)
    renderer.uploadSlice({ x: 0, y: 0, width: 2, height: 1, data: new Uint8Array(8).fill(255) })

    const stale = { x: 2, y: 0, width: 2, height: 1, data: new Uint8Array(8) }
    expect(renderer.uploadSlice(stale)).toBe(false)
    expect(renderer.uploadSlice({ ...stale, x: 0, y: 1 })).toBe(false)
    expect(renderer.uploadSlice({ x: 0, y: 0, width: 2, height: 1, data: new Uint8Array(4) })).toBe(
      false,
    )

    renderer.draw({ scale: 1, params: REFERENCE })
    const out = renderer.readPixels()
    expect([out[0], out[4]]).toEqual([255, 255])
    renderer.dispose()
  })

  it('places a sub-rect at a non-zero y on the right row after the flip', () => {
    const renderer = new GlRenderer(document.createElement('canvas'), {
      preserveDrawingBuffer: true,
    })
    // 1x2 source, all black; then a white 1x1 slice at y = 1 (Chromium's
    // top-down y), which must come out on the bottom row of the canvas.
    renderer.resizeSource(1, 2)
    renderer.uploadSlice({ x: 0, y: 0, width: 1, height: 2, data: new Uint8Array(8) })
    renderer.uploadSlice({
      x: 0,
      y: 1,
      width: 1,
      height: 1,
      data: new Uint8Array([255, 255, 255, 255]),
    })

    renderer.draw({ scale: 1, params: REFERENCE })
    let out = renderer.readPixels() // 1x2, top-down
    expect([out[0], out[4]]).toEqual([0, 255])

    renderer.draw({ scale: 2, params: REFERENCE })
    out = renderer.readPixels() // 2x4, top-down
    const red = (x: number, y: number): number => out[(y * 2 + x) * 4]!
    expect([red(0, 0), red(1, 1), red(0, 2), red(1, 3)]).toEqual([0, 0, 255, 255])
    renderer.dispose()
  })

  it('anchors a fractional scale at the top-left', () => {
    const renderer = new GlRenderer(document.createElement('canvas'), {
      preserveDrawingBuffer: true,
    })
    // 2x2 source: texel (x, y) carries red = x * 255 and green = y * 255.
    renderer.resizeSource(2, 2)
    renderer.uploadSlice({
      x: 0,
      y: 0,
      width: 2,
      height: 2,
      // BGRA, rows top-down.
      data: new Uint8Array([
        0, 0, 0, 255, 0, 0, 255, 255, 0, 255, 0, 255, 0, 255, 255, 255,
      ]),
    })
    renderer.draw({ scale: 1.5, params: REFERENCE })
    expect([renderer.outputWidth, renderer.outputHeight]).toEqual([3, 3])

    const out = renderer.readPixels() // 3x3, top-down
    const texelX = (x: number, y: number): number => out[(y * 3 + x) * 4]! / 255
    const texelY = (x: number, y: number): number => out[(y * 3 + x) * 4 + 1]! / 255
    // Host pixel centres 0.5, 1.5, 2.5 divided by 1.5 fall in texels 0, 1, 1:
    // the partial target pixel lands on the right/bottom edge, never the left/top.
    expect([texelX(0, 0), texelX(1, 0), texelX(2, 0)]).toEqual([0, 1, 1])
    expect([texelY(0, 0), texelY(0, 1), texelY(0, 2)]).toEqual([0, 1, 1])
    renderer.dispose()
  })

  it('clamps the edge texel when the scaled size rounds up', () => {
    const renderer = new GlRenderer(document.createElement('canvas'), {
      preserveDrawingBuffer: true,
    })
    // 3 x 1.5 = 4.5 rounds to 5 host pixels; the last one maps to texel
    // floor(4.5 / 1.5) = 3, one past the edge, and must clamp to texel 2.
    renderer.resizeSource(3, 1)
    renderer.uploadSlice({
      x: 0,
      y: 0,
      width: 3,
      height: 1,
      data: new Uint8Array(12).fill(255),
    })
    renderer.draw({ scale: 1.5, params: REFERENCE })
    expect([renderer.outputWidth, renderer.outputHeight]).toEqual([5, 2])

    const out = renderer.readPixels() // 5x2, top-down
    const red = (x: number, y: number): number => out[(y * 5 + x) * 4]!
    expect([red(4, 0), red(4, 1), red(0, 1)]).toEqual([255, 255, 255])
    renderer.dispose()
  })

  it('skips the draw for a non-positive or non-finite scale', () => {
    const renderer = new GlRenderer(document.createElement('canvas'), {
      preserveDrawingBuffer: true,
    })
    renderer.resizeSource(2, 1)
    renderer.uploadSlice({ x: 0, y: 0, width: 2, height: 1, data: new Uint8Array(8).fill(255) })
    expect(renderer.draw({ scale: 2, params: REFERENCE })).toBe(true)
    expect([renderer.outputWidth, renderer.outputHeight]).toEqual([4, 2])

    for (const scale of [0, -1, NaN, Infinity]) {
      expect(renderer.draw({ scale, params: REFERENCE })).toBe(false)
    }
    // The backing store is untouched by the skipped draws.
    expect([renderer.outputWidth, renderer.outputHeight]).toEqual([4, 2])
    renderer.dispose()
  })
})
