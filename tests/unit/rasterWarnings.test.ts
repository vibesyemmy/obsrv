import { describe, expect, it } from 'vitest'
import { EventEmitter } from 'node:events'
import type { FrameMessage } from '../../src/shared/api'
import { captureQuiescent, type CaptureOptions } from '../../src/cli/capture'
import { RASTER_ANIMATING_WARNING, RASTER_PAINTING_WARNING, rasterWarnings } from '../../src/main/rasterWarnings'

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
/** A full frame with one pixel on the flatness sample grid changed, so it is not held as blank. */
const marked = (w: number, h: number, byte: number): FrameMessage => {
  const m = fullFrame(w, h, byte)
  m.frame.data[4 * 4] = byte ^ 0xff
  return m
}
/** One pixel of a 2x1 frame, and never the other: the budget runs out uncovered. */
const halfPainted: FrameMessage = { frame: { x: 0, y: 0, width: 1, height: 1, data: new Uint8Array(4).fill(3) }, frameWidth: 2, frameHeight: 1 }

const BLANK = 'BLANK SENTENCE, passed in by the caller'

/** A capture through the real `captureQuiescent`, with the raster's warnings wired as `ipc.ts` wires them. */
async function rasterOf(opts: CaptureOptions, src: FakeSource, poke: boolean): Promise<{ reason: string | undefined; warnings: string[] }> {
  const said = rasterWarnings(BLANK)
  const noisy = poke ? setInterval(() => src.invalidate(), 20) : null
  try {
    const got = await captureQuiescent(src, { ...opts, onWarn: said.onWarn })
    return { reason: got.unsettledReason, warnings: said.forVerdict(got.settled, got.unsettledReason) }
  } finally {
    if (noisy) clearInterval(noisy)
  }
}

describe('rasterWarnings: what a live raster says about a frame that did not settle', () => {
  it('on uncovered, says the pixels are transparent, in the capture’s own sentence about this frame, and not that the page was painting', async () => {
    const { reason, warnings } = await rasterOf({ settleMs: 20, timeoutMs: 150 }, new FakeSource([halfPainted]), false)
    expect(reason, 'the fixture no longer reaches uncovered, so nothing below is tested').toBe('uncovered')
    expect(warnings).toHaveLength(1)
    // Its own frame: the 2x1 surface, half of it unpainted, at this budget.
    // **The whole sentence, not two fragments of it** (`c5`, the last unfired
    // producer in the inventory). This used to assert an opening
    // (`/^50\.0% of the 2x1 frame never painted within 150 ms/`) and one middle
    // clause, which left the two halves that carry the actionable part
    // unasserted: the **region**, which tells a reader WHERE the hole is, and
    // the closing, which tells them what they are holding. `#361` moved this
    // verdict to the bytes and took the share and the region with it, so those
    // are exactly the numbers most likely to move and least likely to be
    // noticed moving.
    expect(warnings[0]).toBe(
      '50.0% of the 2x1 frame never painted within 150 ms (uncovered region 1x1 at 1,0); ' +
        'those pixels are transparent, not page content. Returning the frame as captured (settled: false)',
    )
    expect(warnings).not.toContain(RASTER_PAINTING_WARNING)
  })

  it('gives each reason the capture can reach its own sentence', async () => {
    const rows = [
      ['animating', await rasterOf({ settleMs: 100, timeoutMs: 30_000 }, new FakeSource([fullFrame(1, 1, 9)]), true)],
      ['timeout', await rasterOf({ settleMs: 100, timeoutMs: 400, animationExit: false }, new FakeSource([marked(8, 8, 9)]), true)],
      ['blank', await rasterOf({ settleMs: 20, timeoutMs: 400, blankGraceMs: 30 }, new FakeSource([fullFrame(4, 4, 200)]), false)],
      ['uncovered', await rasterOf({ settleMs: 20, timeoutMs: 150 }, new FakeSource([halfPainted]), false)],
    ] as const
    for (const [want, got] of rows) {
      expect(got.reason, `expected ${want}: the fixture no longer produces this case`).toBe(want)
      expect(got.warnings, want).toHaveLength(1)
    }
    const [animating, timeout, blank, uncovered] = rows.map(([, got]) => got.warnings[0])
    expect(animating).toBe(RASTER_ANIMATING_WARNING)
    expect(timeout).toBe(RASTER_PAINTING_WARNING)
    expect(blank).toBe(BLANK)
    expect(uncovered).toMatch(/never painted/)
    // Four reasons, four sentences: a router that sent two reasons to one
    // sentence (the defect) cannot pass this.
    expect(new Set([animating, timeout, blank, uncovered]).size).toBe(4)
  })

  it('says nothing about a settled frame', async () => {
    const { reason, warnings } = await rasterOf({ settleMs: 20, timeoutMs: 2_000 }, new FakeSource([marked(8, 8, 9)]), false)
    expect(reason).toBeUndefined()
    expect(warnings).toEqual([])
  })
})
