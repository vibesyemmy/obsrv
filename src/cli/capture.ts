import type { FrameMessage } from '../shared/api'
import type { RGBAImage } from '../shared/downsample'

/**
 * Frame compositing + quiescence for the headless CLI. Everything here is
 * Electron-free at runtime (types only), so it unit-tests under plain node;
 * `TargetSource` satisfies `FrameEmitter` structurally.
 */

export interface FrameEmitter {
  on(event: 'frame', cb: (m: FrameMessage) => void): unknown
  off(event: 'frame', cb: (m: FrameMessage) => void): unknown
  /** Forces a full-frame repaint — how a capture guarantees full coverage. */
  invalidate(): void
}

export interface CapturedFrame {
  /** Device pixels (CSS viewport × deviceScaleFactor). */
  width: number
  height: number
  /** BGRA, row-major, no padding — the layout Chromium's paint events emit. */
  bgra: Uint8Array
  /**
   * True when paints went quiet within the budget; false for a best-effort
   * capture of a page that never stopped painting (animation, video).
   */
  settled: boolean
}

export interface CaptureOptions {
  /** Paint silence that counts as "settled" (default 400 ms). */
  settleMs?: number
  /** Overall budget; an animating page is captured as-is at this bound. */
  timeoutMs?: number
  onWarn?: (message: string) => void
  /**
   * Checked every poll: a returned error aborts the capture immediately —
   * how a renderer crash mid-capture fails fast instead of burning the
   * timeout and reporting a misleading "no full frame painted".
   */
  failure?: () => Error | null
}

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

export const DEFAULT_SETTLE_MS = 400

/**
 * The uncovered region's bounding box, for the rescue warning: "which part of
 * the frame never painted" is the one thing that makes an unsettled capture
 * actionable. Null when everything is covered.
 */
function uncoveredBounds(mask: Uint8Array, width: number, height: number): { x: number; y: number; width: number; height: number } | null {
  let x0 = width
  let y0 = height
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < height; y++) {
    const row = y * width
    for (let x = 0; x < width; x++) {
      if (mask[row + x] !== 0) continue
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 }
}

/**
 * Forces a repaint, composites dirty BGRA slices into a full device-pixel
 * buffer, and resolves once no paint has arrived for `settleMs` *and* every
 * pixel has been painted at least once since the last frame-size change
 * (partial slices against an uncovered buffer are not a picture). Coverage is
 * cumulative: after a viewport growth (--full-page) Chromium was observed to
 * deliver the repaint of a large surface as several dirty slices and never a
 * single full-frame one, so a "one full paint" flag would wait forever.
 *
 * At `timeoutMs` the capture is rescued rather than failed, as long as any
 * pixels arrived: a covered-but-noisy page (animation, video) and a page whose
 * coverage never completed both come back `settled: false` with a warning
 * naming what was missing. An unsettled picture of the page beats no picture,
 * and the caller can gate on the flag. Only a surface that painted *nothing*
 * is an error — there is no image to return.
 *
 * The accumulated buffer is the rescue image on purpose. `capturePage()` does
 * work on an offscreen window, but it hands back a 1x (DIP-sized) bitmap —
 * 393x852 for a dsf-2 render whose raster is 786x1704, `getScaleFactors()`
 * `[1]` — and a snap that silently dropped to a third of the device pixels
 * would be a worse lie than an unsettled frame.
 */
export async function captureQuiescent(source: FrameEmitter, options: CaptureOptions = {}): Promise<CapturedFrame> {
  const settleMs = options.settleMs ?? DEFAULT_SETTLE_MS
  const timeoutMs = options.timeoutMs ?? 30_000

  let width = 0
  let height = 0
  let buffer = new Uint8Array(0)
  let covered = false
  /** Per-pixel paint accounting; freed the moment coverage completes. */
  let mask: Uint8Array | null = null
  let uncovered = 0
  let lastPaint = Date.now()
  /** Any pixels at all? The difference between a rescue and a hard failure. */
  let frames = 0

  const onFrame = (m: FrameMessage): void => {
    lastPaint = Date.now()
    frames++
    if (m.frameWidth !== width || m.frameHeight !== height) {
      width = m.frameWidth
      height = m.frameHeight
      buffer = new Uint8Array(width * height * 4)
      covered = false
      mask = new Uint8Array(width * height)
      uncovered = width * height
    }
    const { x, y, width: w, height: h, data } = m.frame
    if (x === 0 && y === 0 && w === width && h === height) {
      buffer.set(data)
      covered = true
      mask = null
      return
    }
    for (let row = 0; row < h; row++) {
      const src = row * w * 4
      buffer.set(data.subarray(src, src + w * 4), ((y + row) * width + x) * 4)
    }
    if (!covered && mask) {
      for (let row = 0; row < h; row++) {
        let p = (y + row) * width + x
        for (let col = 0; col < w; col++, p++) {
          if (mask[p] === 0) {
            mask[p] = 1
            uncovered--
          }
        }
      }
      if (uncovered === 0) {
        covered = true
        mask = null
      }
    }
  }

  source.on('frame', onFrame)
  try {
    source.invalidate()
    let settled = true
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const failed = options.failure?.()
      if (failed) throw failed
      if (covered && Date.now() - lastPaint >= settleMs) break
      if (Date.now() >= deadline) {
        settled = false
        if (covered) {
          options.onWarn?.(`page kept painting for ${timeoutMs} ms (animation?); capturing the current frame`)
          break
        }
        if (frames === 0 || width === 0 || height === 0) {
          throw new Error(`no frame painted within ${timeoutMs} ms`)
        }
        const total = width * height
        const box = mask ? uncoveredBounds(mask, width, height) : null
        options.onWarn?.(
          `warning: ${((uncovered / total) * 100).toFixed(1)}% of the ${width}x${height} frame ` +
            `never painted within ${timeoutMs} ms` +
            (box ? ` (uncovered region ${box.width}x${box.height} at ${box.x},${box.y})` : '') +
            `; returning the frame as captured (settled: false)`,
        )
        break
      }
      await sleep(Math.min(50, settleMs))
    }
    return { width, height, bgra: buffer.slice(), settled }
  } finally {
    source.off('frame', onFrame)
  }
}

/** Chromium paint bitmaps are BGRA; the CPU pixel pipeline wants RGBA. */
export function bgraToRgba(bgra: Uint8Array, width: number, height: number): RGBAImage {
  const data = new Uint8ClampedArray(bgra.length)
  for (let i = 0; i < bgra.length; i += 4) {
    data[i] = bgra[i + 2]!
    data[i + 1] = bgra[i + 1]!
    data[i + 2] = bgra[i]!
    data[i + 3] = 255
  }
  return { width, height, data }
}
