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
}

export interface CaptureOptions {
  /** Paint silence that counts as "settled" (default 400 ms). */
  settleMs?: number
  /** Overall budget; an animating page is captured as-is at this bound. */
  timeoutMs?: number
  onWarn?: (message: string) => void
}

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

export const DEFAULT_SETTLE_MS = 400

/**
 * Forces a repaint, composites dirty BGRA slices into a full device-pixel
 * buffer, and resolves once no paint has arrived for `settleMs` *and* at
 * least one full-coverage frame has been seen since the last frame-size
 * change (partial slices against an uncovered buffer are not a picture).
 * At `timeoutMs` a covered-but-noisy page (animation, video) is captured
 * as-is with a warning; a never-covered surface is an error.
 */
export async function captureQuiescent(source: FrameEmitter, options: CaptureOptions = {}): Promise<CapturedFrame> {
  const settleMs = options.settleMs ?? DEFAULT_SETTLE_MS
  const timeoutMs = options.timeoutMs ?? 30_000

  let width = 0
  let height = 0
  let buffer = new Uint8Array(0)
  let covered = false
  let lastPaint = Date.now()

  const onFrame = (m: FrameMessage): void => {
    lastPaint = Date.now()
    if (m.frameWidth !== width || m.frameHeight !== height) {
      width = m.frameWidth
      height = m.frameHeight
      buffer = new Uint8Array(width * height * 4)
      covered = false
    }
    const { x, y, width: w, height: h, data } = m.frame
    if (x === 0 && y === 0 && w === width && h === height) {
      buffer.set(data)
      covered = true
      return
    }
    for (let row = 0; row < h; row++) {
      const src = row * w * 4
      buffer.set(data.subarray(src, src + w * 4), ((y + row) * width + x) * 4)
    }
  }

  source.on('frame', onFrame)
  try {
    source.invalidate()
    const deadline = Date.now() + timeoutMs
    for (;;) {
      if (covered && Date.now() - lastPaint >= settleMs) break
      if (Date.now() >= deadline) {
        if (!covered) throw new Error(`no full frame painted within ${timeoutMs} ms`)
        options.onWarn?.(`page kept painting for ${timeoutMs} ms (animation?); capturing the current frame`)
        break
      }
      await sleep(Math.min(50, settleMs))
    }
    return { width, height, bgra: buffer.slice() }
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
