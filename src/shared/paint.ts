import type { Rect } from './api'

/**
 * Chromium's offscreen `paint` damage rects are *almost* always in device
 * pixels — the same space as the bitmap `image.getSize()` reports. The one
 * exception is the repaint forced by `webContents.invalidate()`: Electron
 * invalidates the view's *DIP* bounds, so at `deviceScaleFactor` 2 a full
 * repaint of an 800x600 raster arrives as `0,0 400x300`.
 *
 * Measured on Electron 43 / macOS (offscreen window, with and without device
 * emulation), CSS viewport 400x300:
 *
 * | event                     | dsf 1        | dsf 2         | dsf 3          |
 * |---------------------------|--------------|---------------|----------------|
 * | first paint after load    | 0,0 400x300  | 0,0 800x600   | 0,0 1200x900   |
 * | partial repaint of a box  | 100,60 40x30 | 200,120 80x60 | 300,180 120x90 |
 * | after `invalidate()`      | 0,0 400x300  | 0,0 400x300   | 0,0 400x300    |
 * | `image.getSize()`         | 400x300      | 800x600       | 1200x900       |
 *
 * Read literally, that invalidate rect makes a full repaint look like a
 * top-left slice covering 1/dsf² of the frame: the crop takes the wrong
 * region, and a cumulative coverage gate can never fill the other 75% (dsf 2)
 * or 89% (dsf 3). That was the "no full frame painted within N ms" failure on
 * dense-DPR presets — page-dependent only because a page that happens to emit
 * one *ordinary* full-frame paint after the invalidate is rescued by it.
 *
 * `isFullFrame` recognises both spellings of "the whole frame". A device-pixel
 * partial repaint that lands exactly on the DIP full-view rect would be read as
 * a full frame too; that is deliberately the safe direction to be wrong in —
 * the caller then sends the entire (correct) bitmap instead of a slice, costing
 * bandwidth, never pixels. Being wrong the other way is the bug above.
 */
export function isFullFrame(dirty: Rect, frameWidth: number, frameHeight: number, deviceScaleFactor: number): boolean {
  if (dirty.x !== 0 || dirty.y !== 0) return false
  if (dirty.width === frameWidth && dirty.height === frameHeight) return true
  if (!(deviceScaleFactor > 1)) return false
  // The DIP spelling: `invalidate()` damages the view bounds, which Chromium
  // rounds up from the device-pixel raster.
  return dirty.width === Math.round(frameWidth / deviceScaleFactor) && dirty.height === Math.round(frameHeight / deviceScaleFactor)
}

/**
 * Whether a dirty rect, read as device pixels, actually lies inside the
 * bitmap. A rect that does not is not croppable and would corrupt the
 * composite; callers drop it rather than guess at its units.
 */
export function fitsFrame(dirty: Rect, frameWidth: number, frameHeight: number): boolean {
  return (
    dirty.x >= 0 &&
    dirty.y >= 0 &&
    dirty.width > 0 &&
    dirty.height > 0 &&
    dirty.x + dirty.width <= frameWidth &&
    dirty.y + dirty.height <= frameHeight
  )
}

/**
 * How long a surface must go without a paint before it counts as settled.
 *
 * Both capture paths cite this one number so they cannot drift: the headless
 * CLI (`captureQuiescent`) and the live in-app capture behind agent control.
 * They used to disagree — the CLI waited for paint silence while the live path
 * waited only for the viewport to stop resizing, so a capture taken straight
 * after a reload photographed the page mid-hydration. Hydration does not change
 * the viewport, so nothing the live path watched had moved.
 */
export const SETTLE_QUIET_MS = 400

/**
 * The pixels Chromium actually paints into an offscreen bitmap for a CSS
 * viewport at a density. A fractional density can put `CSS × dsf` between
 * two whole pixels — 412 × 2.625 is 1081.5 — and then Electron allocates the
 * bitmap at the rounding (1082) while Chromium's viewport is the floor
 * (1081): the last column, and row, are never painted. Measured on the
 * Pixel preset: a black edge, and a capture that never went quiet because
 * its coverage mask never filled. So the frame is the floor, and only when
 * the bitmap is that rounding — a bitmap of some other size is a frame
 * painted against a previous viewport, still in flight, and is left whole.
 */
export function paintedExtent(
  full: { width: number; height: number },
  viewport: { width: number; height: number },
  dsf: number,
): { width: number; height: number } {
  const w = viewport.width * dsf
  const h = viewport.height * dsf
  // The epsilon absorbs float noise in a product that is whole in decimal.
  return {
    width: full.width === Math.round(w) ? Math.min(full.width, Math.floor(w + 1e-6)) : full.width,
    height: full.height === Math.round(h) ? Math.min(full.height, Math.floor(h + 1e-6)) : full.height,
  }
}

/** `rect` cut to the extent; null when nothing of it is inside. */
export function clipToExtent(
  rect: { x: number; y: number; width: number; height: number },
  extent: { width: number; height: number },
): { x: number; y: number; width: number; height: number } | null {
  const x1 = Math.min(rect.x + rect.width, extent.width)
  const y1 = Math.min(rect.y + rect.height, extent.height)
  if (rect.x >= x1 || rect.y >= y1) return null
  return { x: rect.x, y: rect.y, width: x1 - rect.x, height: y1 - rect.y }
}

/**
 * Whether a frame is one colour end to end — what a page shows between
 * painting its background and painting its content. espn.com paints white,
 * goes quiet for longer than the settle window, and paints the page a second
 * later; both capture paths took the white and called it settled. Sampled on
 * a grid rather than read whole: a page with anything on it differs from its
 * first pixel within a few rows, so the scan ends almost at once on a real
 * frame, and only a truly flat one is read to the end. Four bytes a pixel,
 * BGRA or RGBA alike; the step is the resolution, and a stray line thinner
 * than it between samples is not seen — a page with nothing but that on it
 * is blank for any purpose a capture serves.
 */
export const FLAT_SAMPLE_STEP = 4

export function isFlatFrame(pixels: Uint8Array, width: number, height: number, step = FLAT_SAMPLE_STEP): boolean {
  if (!(width > 0) || !(height > 0) || !(step > 0) || pixels.length < width * height * 4) return false
  const c0 = pixels[0]
  const c1 = pixels[1]
  const c2 = pixels[2]
  const c3 = pixels[3]
  const stride = width * 4
  for (let y = 0; y < height; y += step) {
    let p = y * stride
    for (let x = 0; x < width; x += step, p += step * 4) {
      if (pixels[p] !== c0 || pixels[p + 1] !== c1 || pixels[p + 2] !== c2 || pixels[p + 3] !== c3) return false
    }
  }
  return true
}

/** The one colour of a flat BGRA frame as `#rrggbb`, for the warning that names it. */
export function flatColourHex(bgra: Uint8Array): string {
  const h = (v: number): string => v.toString(16).padStart(2, '0')
  return `#${h(bgra[2] ?? 0)}${h(bgra[1] ?? 0)}${h(bgra[0] ?? 0)}`
}

/**
 * How much longer a covered, quiet, one-colour frame is given to paint
 * something before it is returned as the capture, unsettled and named
 * blank. Three seconds is well past the gap espn.com leaves between its
 * background and its page (0.5–1 s) and short enough that a page which
 * really is one colour costs little. Both capture paths cite it, like
 * `SETTLE_QUIET_MS`.
 */
export const BLANK_GRACE_MS = 3_000

/** The warning a blank frame comes back with: what the frame is, and the two things that can mean. */
export function blankWarning(bgra: Uint8Array, quietMs: number): string {
  return (
    `the frame is one colour end to end (${flatColourHex(bgra)}) and stayed that way for ${quietMs} ms: the page painted its ` +
    `background and nothing else in that time, or the page really is empty; capturing it as it stands (settled: false, blank) — ` +
    `raise --wait for a page that paints late`
  )
}
