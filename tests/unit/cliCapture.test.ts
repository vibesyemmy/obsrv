import { describe, it, expect } from 'vitest'
import { EventEmitter } from 'node:events'
import type { FrameMessage } from '../../src/shared/api'
import { ANIMATING_AFTER_MS, ANIMATING_MIN_PAINTS, bgraToRgba, captureQuiescent } from '../../src/cli/capture'

/** Emits scripted frames when poked; `invalidate()` replays the script once. */
class FakeSource extends EventEmitter {
  constructor(private readonly script: FrameMessage[]) {
    super()
  }
  invalidate(): void {
    for (const m of this.script) this.emit('frame', m)
  }
}

const fullFrame = (w: number, h: number, byte: number): FrameMessage => ({
  frame: { x: 0, y: 0, width: w, height: h, data: new Uint8Array(w * h * 4).fill(byte) },
  frameWidth: w,
  frameHeight: h,
})

describe('captureQuiescent', () => {
  it('resolves with the composited full frame once paints go quiet', async () => {
    const src = new FakeSource([fullFrame(2, 2, 7)])
    const got = await captureQuiescent(src, { settleMs: 30, timeoutMs: 2000 })
    expect(got.width).toBe(2)
    expect(got.height).toBe(2)
    expect(Array.from(got.bgra)).toEqual(Array(16).fill(7))
  })
  it('composites a later dirty slice at its offset', async () => {
    const slice: FrameMessage = {
      frame: { x: 1, y: 1, width: 1, height: 1, data: new Uint8Array([9, 9, 9, 9]) },
      frameWidth: 2,
      frameHeight: 2,
    }
    const src = new FakeSource([fullFrame(2, 2, 0), slice])
    const got = await captureQuiescent(src, { settleMs: 30, timeoutMs: 2000 })
    expect(Array.from(got.bgra.subarray(12, 16))).toEqual([9, 9, 9, 9])
    expect(Array.from(got.bgra.subarray(0, 4))).toEqual([0, 0, 0, 0])
  })
  it('partial slices that together cover the frame count as covered (post-resize tiled repaints)', async () => {
    // Chromium was observed to repaint a grown surface as several dirty
    // slices with no single full-frame paint; cumulative coverage must do.
    const half = (y: number, byte: number): FrameMessage => ({
      frame: { x: 0, y, width: 2, height: 1, data: new Uint8Array(8).fill(byte) },
      frameWidth: 2,
      frameHeight: 2,
    })
    const src = new FakeSource([half(0, 4), half(1, 6)])
    const got = await captureQuiescent(src, { settleMs: 30, timeoutMs: 2000 })
    expect(Array.from(got.bgra.subarray(0, 8))).toEqual(Array(8).fill(4))
    expect(Array.from(got.bgra.subarray(8, 16))).toEqual(Array(8).fill(6))
  })
  it('a frame-size change resets coverage: a never-covered frame is rescued, not failed', async () => {
    // Full 1x1 frame, then only a partial slice of the new 2x2 size: coverage
    // is never re-established. The pixels that did arrive are still a better
    // answer than an error, so the capture comes back settled: false with a
    // warning naming the region that never painted.
    const partial: FrameMessage = {
      frame: { x: 0, y: 0, width: 1, height: 1, data: new Uint8Array(4).fill(3) },
      frameWidth: 2,
      frameHeight: 2,
    }
    const src = new FakeSource([fullFrame(1, 1, 5), partial])
    const warnings: string[] = []
    const got = await captureQuiescent(src, { settleMs: 20, timeoutMs: 200, onWarn: m => warnings.push(m) })
    expect(got.settled).toBe(false)
    expect(got.width).toBe(2)
    expect(got.height).toBe(2)
    expect(Array.from(got.bgra.subarray(0, 4))).toEqual([3, 3, 3, 3])
    expect(warnings.join(' ')).toMatch(/75\.0% of the 2x2 frame never painted/)
    // The bounding box of the three pixels that never arrived.
    expect(warnings.join(' ')).toMatch(/uncovered region 2x2 at 0,0/)
  })
  it('rejects only when nothing ever paints', async () => {
    await expect(captureQuiescent(new FakeSource([]), { settleMs: 20, timeoutMs: 150 })).rejects.toThrow(/no frame painted/)
  })
  it('reports settled: true for a quiet capture', async () => {
    const got = await captureQuiescent(new FakeSource([fullFrame(1, 1, 1)]), { settleMs: 20, timeoutMs: 1000 })
    expect(got.settled).toBe(true)
  })
  it('a covered but never-quiet page is captured best-effort with settled: false', async () => {
    // Repaints keep arriving faster than the settle window for the whole budget.
    const src = new FakeSource([fullFrame(1, 1, 8)])
    const noisy = setInterval(() => src.invalidate(), 10)
    try {
      const warnings: string[] = []
      const got = await captureQuiescent(src, { settleMs: 100, timeoutMs: 300, onWarn: m => warnings.push(m) })
      expect(got.settled).toBe(false)
      expect(Array.from(got.bgra)).toEqual(Array(4).fill(8))
      expect(warnings.join(' ')).toMatch(/kept painting/)
    } finally {
      clearInterval(noisy)
    }
  })
  it('a covered page that keeps painting steadily is captured early as animating, not at the budget', async () => {
    const src = new FakeSource([fullFrame(1, 1, 9)])
    const noisy = setInterval(() => src.invalidate(), 20)
    try {
      const warnings: string[] = []
      const t0 = Date.now()
      const got = await captureQuiescent(src, { settleMs: 100, timeoutMs: 30_000, onWarn: m => warnings.push(m) })
      const took = Date.now() - t0
      expect(got.settled).toBe(false)
      expect(got.unsettledReason).toBe('animating')
      expect(took).toBeGreaterThanOrEqual(ANIMATING_AFTER_MS - 50)
      expect(took).toBeLessThan(ANIMATING_AFTER_MS + 1_500)
      expect(warnings.join(' ')).toMatch(/painting steadily/)
      expect(ANIMATING_MIN_PAINTS).toBeLessThanOrEqual(ANIMATING_AFTER_MS / 20)
    } finally {
      clearInterval(noisy)
    }
  })

  it('with the animation exit off, the same page runs to the budget and says timeout', async () => {
    const src = new FakeSource([fullFrame(1, 1, 9)])
    const noisy = setInterval(() => src.invalidate(), 20)
    try {
      const got = await captureQuiescent(src, { settleMs: 100, timeoutMs: 400, animationExit: false })
      expect(got.settled).toBe(false)
      expect(got.unsettledReason).toBe('timeout')
    } finally {
      clearInterval(noisy)
    }
  })

  it('a frame that never fills says uncovered', async () => {
    const half: FrameMessage = { frame: { x: 0, y: 0, width: 1, height: 1, data: new Uint8Array(4).fill(3) }, frameWidth: 2, frameHeight: 1 }
    const got = await captureQuiescent(new FakeSource([half]), { settleMs: 20, timeoutMs: 150, onWarn: () => {} })
    expect(got.settled).toBe(false)
    expect(got.unsettledReason).toBe('uncovered')
  })

  it('an external failure aborts immediately instead of burning the timeout', async () => {
    const t0 = Date.now()
    let failed: Error | null = null
    setTimeout(() => (failed = new Error('renderer crashed: oom')), 50)
    await expect(
      captureQuiescent(new FakeSource([]), { settleMs: 20, timeoutMs: 10_000, failure: () => failed }),
    ).rejects.toThrow(/renderer crashed/)
    expect(Date.now() - t0).toBeLessThan(2000)
  })
})

describe('bgraToRgba', () => {
  it('swaps channels and forces alpha opaque', () => {
    const rgba = bgraToRgba(new Uint8Array([10, 20, 30, 40]), 1, 1)
    expect(Array.from(rgba.data)).toEqual([30, 20, 10, 255])
    expect(rgba.width).toBe(1)
    expect(rgba.height).toBe(1)
  })
})
