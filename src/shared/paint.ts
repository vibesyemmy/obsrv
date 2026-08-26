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
