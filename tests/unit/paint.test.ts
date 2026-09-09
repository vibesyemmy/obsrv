import { describe, expect, it } from 'vitest'
import { blankWarning, fitsFrame, flatColourHex, isFlatFrame, isFullFrame } from '../../src/shared/paint'

/**
 * Pins the dirty-rect → coverage conversion. The numbers are the ones measured
 * on Electron 43 / macOS against an offscreen window at CSS 400x300 (see the
 * table in src/shared/paint.ts): every ordinary paint reports device pixels,
 * and the repaint `webContents.invalidate()` forces reports DIPs — which is
 * what made dense-DPR captures stall at exactly 1/dsf² coverage.
 */
describe('isFullFrame', () => {
  it('accepts a device-pixel full frame at any density', () => {
    expect(isFullFrame({ x: 0, y: 0, width: 400, height: 300 }, 400, 300, 1)).toBe(true)
    expect(isFullFrame({ x: 0, y: 0, width: 800, height: 600 }, 800, 600, 2)).toBe(true)
    expect(isFullFrame({ x: 0, y: 0, width: 1200, height: 900 }, 1200, 900, 3)).toBe(true)
  })
  it("accepts invalidate()'s DIP-sized full frame — the bug this exists for", () => {
    // dsf 2: the whole 800x600 raster arrives labelled 400x300.
    expect(isFullFrame({ x: 0, y: 0, width: 400, height: 300 }, 800, 600, 2)).toBe(true)
    // dsf 3: the whole 1200x900 raster arrives labelled 400x300.
    expect(isFullFrame({ x: 0, y: 0, width: 400, height: 300 }, 1200, 900, 3)).toBe(true)
  })
  it('leaves genuine partial repaints partial', () => {
    // The measured partial repaint of a CSS box at (100,60) 40x30.
    expect(isFullFrame({ x: 200, y: 120, width: 80, height: 60 }, 800, 600, 2)).toBe(false)
    expect(isFullFrame({ x: 300, y: 180, width: 120, height: 90 }, 1200, 900, 3)).toBe(false)
    // Same size as the DIP full frame but not at the origin: not a full frame.
    expect(isFullFrame({ x: 1, y: 0, width: 400, height: 300 }, 800, 600, 2)).toBe(false)
  })
  it('never reads a 1x frame in DIP space (there is no second spelling at dsf 1)', () => {
    expect(isFullFrame({ x: 0, y: 0, width: 200, height: 150 }, 400, 300, 1)).toBe(false)
  })
  it('rounds the DIP size the way Chromium sizes the view', () => {
    // 1640x2360 at dsf 2 (ipad-109) is exactly 820x1180 DIPs.
    expect(isFullFrame({ x: 0, y: 0, width: 820, height: 1180 }, 1640, 2360, 2)).toBe(true)
    // An odd raster: 1171 device px is 390.33 DIPs, which Chromium reports as 390.
    expect(isFullFrame({ x: 0, y: 0, width: 390, height: 844 }, 1171, 2532, 3)).toBe(true)
  })
  it('is exactly the 1/dsf² coverage the stall reproduced', () => {
    // Read as a partial slice, the dsf-2 invalidate rect covers a quarter of
    // the frame and a cumulative gate stalls at 75% uncovered forever.
    const dip = { x: 0, y: 0, width: 400, height: 300 }
    expect((dip.width * dip.height) / (800 * 600)).toBeCloseTo(1 / 4)
    expect(isFullFrame(dip, 800, 600, 2)).toBe(true)
  })
})

describe('fitsFrame', () => {
  it('accepts a slice inside the bitmap', () => {
    expect(fitsFrame({ x: 200, y: 120, width: 80, height: 60 }, 800, 600)).toBe(true)
    expect(fitsFrame({ x: 0, y: 0, width: 800, height: 600 }, 800, 600)).toBe(true)
  })
  it.each([
    ['past the right edge', { x: 790, y: 0, width: 20, height: 10 }],
    ['past the bottom edge', { x: 0, y: 595, width: 10, height: 20 }],
    ['a negative origin', { x: -1, y: 0, width: 10, height: 10 }],
    ['an empty rect', { x: 0, y: 0, width: 0, height: 10 }],
  ])('rejects %s', (_name, rect) => {
    expect(fitsFrame(rect, 800, 600)).toBe(false)
  })
})

/**
 * The blank-frame check behind the `blank` unsettled reason: espn.com's
 * white frame, quiet for longer than the settle window, was a settled capture
 * on every surface until this said what it was.
 */
describe('isFlatFrame', () => {
  const frame = (w: number, h: number, fill: number): Uint8Array => new Uint8Array(w * h * 4).fill(fill)
  it('is true for a frame of one colour', () => {
    expect(isFlatFrame(frame(64, 32, 255), 64, 32)).toBe(true)
    expect(isFlatFrame(frame(9, 9, 0), 9, 9)).toBe(true)
  })
  it('is false as soon as a sampled pixel differs in any channel', () => {
    const f = frame(64, 32, 255)
    f[(16 * 64 + 20) * 4 + 1] = 0
    expect(isFlatFrame(f, 64, 32)).toBe(false)
    const g = frame(64, 32, 255)
    g[(28 * 64 + 60) * 4 + 3] = 0
    expect(isFlatFrame(g, 64, 32)).toBe(false)
  })
  it('samples a grid: the step is the resolution', () => {
    const f = frame(64, 32, 255)
    f[(1 * 64 + 1) * 4] = 0
    expect(isFlatFrame(f, 64, 32, 4)).toBe(true)
    expect(isFlatFrame(f, 64, 32, 1)).toBe(false)
  })
  it('is false for a frame it cannot read', () => {
    expect(isFlatFrame(new Uint8Array(0), 0, 0)).toBe(false)
    expect(isFlatFrame(frame(2, 2, 1), 4, 4)).toBe(false)
  })
  it('names the colour of a BGRA frame as #rrggbb', () => {
    expect(flatColourHex(new Uint8Array([255, 255, 255, 255]))).toBe('#ffffff')
    expect(flatColourHex(new Uint8Array([0x33, 0x22, 0x11, 255]))).toBe('#112233')
    expect(blankWarning(new Uint8Array([255, 255, 255, 255]), 3000)).toMatch(/one colour end to end \(#ffffff\) and stayed that way for 3000 ms/)
  })
})
