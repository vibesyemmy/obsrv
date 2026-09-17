import { describe, it, expect } from 'vitest'
import { EventEmitter } from 'node:events'
import type { FrameMessage } from '../../src/shared/api'
import type { UnsettledReason } from '../../src/cli/capture'
import { ANIMATING_AFTER_MS, ANIMATING_MIN_PAINTS, bgraToRgba, captureQuiescent, explainedByCutLoad, stitchBands } from '../../src/cli/capture'

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
/**
 * A full frame with something on it: one pixel on the flatness check's sample
 * grid differs, so the capture does not hold it for the blank grace. The
 * one-colour frames above are the page's background, and are held.
 */
const marked = (w: number, h: number, byte: number): FrameMessage => {
  const m = fullFrame(w, h, byte)
  m.frame.data[4 * 4] = byte ^ 0xff
  return m
}
/** Compositing tests use one-colour frames; the grace is not what they test. */
const noGrace = { blankGraceMs: 0 }

describe('captureQuiescent', () => {
  it('resolves with the composited full frame once paints go quiet', async () => {
    const src = new FakeSource([fullFrame(2, 2, 7)])
    const got = await captureQuiescent(src, { settleMs: 30, timeoutMs: 2000, ...noGrace })
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
    const got = await captureQuiescent(src, { settleMs: 30, timeoutMs: 2000, ...noGrace })
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
    const got = await captureQuiescent(src, { settleMs: 30, timeoutMs: 2000, ...noGrace })
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
    const got = await captureQuiescent(new FakeSource([marked(8, 8, 1)]), { settleMs: 20, timeoutMs: 1000 })
    expect(got.settled).toBe(true)
  })
  it('a covered but never-quiet page is captured best-effort with settled: false', async () => {
    // Repaints keep arriving faster than the settle window for the whole budget.
    const src = new FakeSource([marked(8, 8, 8)])
    const noisy = setInterval(() => src.invalidate(), 10)
    try {
      const warnings: string[] = []
      const got = await captureQuiescent(src, { settleMs: 100, timeoutMs: 300, onWarn: m => warnings.push(m) })
      expect(got.settled).toBe(false)
      expect(got.bgra).toHaveLength(8 * 8 * 4)
      expect(got.bgra[0]).toBe(8)
      expect(got.unsettledReason).toBe('timeout')
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
    const src = new FakeSource([marked(8, 8, 9)])
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

  /**
   * CHARACTERIZATION, not a fix (`bug-product-matches-own-prose`).
   *
   * `src/cli/main.ts` decides whether to suppress a capture warning by
   * matching the warning's own sentence — `/kept painting/.test(m)` — after a
   * load the budget cut short, because the load warning already explained it.
   * `compatibility.md` tells callers never to match on prose, and
   * `read-the-output-not-the-code` commits this project to rewording warnings
   * whenever they get clearer. Reword either sentence below and the routing
   * changes silently: nothing throws.
   *
   * This pins the pairing the regex depends on — which reason carries which
   * sentence — BEFORE anything is changed, so that "the fix is
   * behaviour-identical" is a claim the suite checks rather than one a person
   * checked once. Every reason `captureQuiescent` can emit a warning for is
   * here, with today's verdict beside it.
   *
   * **What this does NOT pin, and it is the point of the card:** the routing
   * decision itself. It is an inline arrow function inside `render()` in a
   * 1600-line file, unexported and reachable only by driving a real Electron
   * target — so there is no test anywhere that the suppression happens. The
   * fix makes that testable; this test cannot.
   */
  it('records which unsettled reason carries which sentence, and how the prose match routes each', async () => {
    // Returns the pair rather than a joined string. The first version joined
    // on a NUL separator, which wrote two literal control bytes into this file
    // — invisible in a diff, and enough for `ugrep -I` to classify the whole
    // file as binary and skip it, so every `grep` for anything in this file
    // returned nothing. Found by chasing that false negative.
    const said = async (
      opts: Parameters<typeof captureQuiescent>[1],
      src: FakeSource,
      poke: boolean,
    ): Promise<{ reason: string | undefined; message: string }> => {
      const warnings: string[] = []
      const noisy = poke ? setInterval(() => src.invalidate(), 20) : null
      try {
        const got = await captureQuiescent(src, { ...opts, onWarn: m => warnings.push(m) })
        return { reason: got.unsettledReason, message: warnings.join(' ') }
      } finally {
        if (noisy) clearInterval(noisy)
      }
    }

    const cases = [
      ['animating', await said({ settleMs: 100, timeoutMs: 30_000 }, new FakeSource([fullFrame(1, 1, 9)]), true)],
      ['timeout', await said({ settleMs: 100, timeoutMs: 400, animationExit: false }, new FakeSource([marked(8, 8, 9)]), true)],
      ['blank', await said({ settleMs: 20, timeoutMs: 400, blankGraceMs: 30 }, new FakeSource([fullFrame(4, 4, 200)]), false)],
      [
        'uncovered',
        await said({ settleMs: 20, timeoutMs: 150 }, new FakeSource([{ frame: { x: 0, y: 0, width: 1, height: 1, data: new Uint8Array(4).fill(3) }, frameWidth: 2, frameHeight: 1 }]), false),
      ],
    ] as const

    // What `/kept painting/` did to each of these messages, measured against
    // the real sentences on 2026-09-16 before the routing changed. Written as
    // data rather than as a live copy of the old regex: a copied predicate in
    // a test is the same defect as the one in the product, and it would make
    // this test fail whenever a sentence is reworded — which is exactly the
    // coupling being removed.
    const verdictOfTheOldProseMatch: Record<string, boolean> = {
      animating: true, // "page kept painting steadily for N ms…"
      timeout: true, //   "page kept painting for N ms (animation?)…"
      blank: false, //    "the frame is one colour end to end…"
      uncovered: false, // "N% of the frame never painted within N ms"
    }

    const table = cases.map(([want, got]) => {
      const { reason, message } = got
      expect(reason, `expected reason ${want}, got ${reason} — the fixture no longer produces this case`).toBe(want)
      expect(message.length, `${want} emitted no warning: nothing to route, and this row proves nothing`).toBeGreaterThan(0)
      // The equivalence that makes "behaviour-identical" a fact rather than a
      // claim: routing on the reason gives, for every reason the capture can
      // warn for, the verdict the prose match gave.
      expect(explainedByCutLoad(reason as UnsettledReason), `${reason}: the fix disagrees with the behaviour it replaced`).toBe(
        verdictOfTheOldProseMatch[want],
      )
      return `${reason}:${explainedByCutLoad(reason as UnsettledReason) ? 'suppressed' : 'kept'}`
    })

    // Both verdicts appear, so the routing is discriminating rather than
    // saturated — a table of four "kept" would pass while testing nothing.
    expect(table).toEqual(['animating:suppressed', 'timeout:suppressed', 'blank:kept', 'uncovered:kept'])
  })

  /**
   * The fix for `bug-product-matches-own-prose`: the reason travels with the
   * warning, so the caller routes on the fact rather than on the sentence.
   *
   * `unsettledReason` is already set on the line immediately above every
   * `onWarn` call in this file — the structured fact existed where the warning
   * was raised and was simply not passed. Nothing reaches `warnings[]`: this
   * is a second argument on the callback, consumed at the routing site and
   * discarded, so no output schema gains a field.
   */
  it('hands the caller the reason alongside the message, for every reason it warns for', async () => {
    const seen = async (opts: Parameters<typeof captureQuiescent>[1], src: FakeSource, poke: boolean): Promise<string[]> => {
      const got: string[] = []
      const noisy = poke ? setInterval(() => src.invalidate(), 20) : null
      try {
        await captureQuiescent(src, { ...opts, onWarn: (_m, reason) => got.push(String(reason)) })
        return got
      } finally {
        if (noisy) clearInterval(noisy)
      }
    }
    expect(await seen({ settleMs: 100, timeoutMs: 30_000 }, new FakeSource([fullFrame(1, 1, 9)]), true)).toEqual(['animating'])
    expect(await seen({ settleMs: 100, timeoutMs: 400, animationExit: false }, new FakeSource([marked(8, 8, 9)]), true)).toEqual(['timeout'])
    expect(await seen({ settleMs: 20, timeoutMs: 400, blankGraceMs: 30 }, new FakeSource([fullFrame(4, 4, 200)]), false)).toEqual(['blank'])
    const partial: FrameMessage = { frame: { x: 0, y: 0, width: 1, height: 1, data: new Uint8Array(4).fill(3) }, frameWidth: 2, frameHeight: 1 }
    expect(await seen({ settleMs: 20, timeoutMs: 150 }, new FakeSource([partial]), false)).toEqual(['uncovered'])
  })
})

/**
 * The routing decision `bug-product-matches-own-prose` is about, extracted so
 * that it can be tested at all. Until this existed it was an inline arrow
 * inside `render()` in a 1600-line file, unexported and reachable only by
 * driving a real Electron target — which is why a defect in it survived.
 */
describe('explainedByCutLoad: which capture warnings a cut-short load has already accounted for', () => {
  it('suppresses exactly the two the load warning already explains', () => {
    expect(explainedByCutLoad('animating')).toBe(true)
    expect(explainedByCutLoad('timeout')).toBe(true)
  })

  it('keeps the two that say something the load warning does not', () => {
    // A blank frame and an uncovered one are facts about the raster, not about
    // the budget running out. Suppressing them would lose the only sentence
    // saying the image is not what it appears to be.
    expect(explainedByCutLoad('blank')).toBe(false)
    expect(explainedByCutLoad('uncovered')).toBe(false)
    expect(explainedByCutLoad('loading')).toBe(false)
  })

  it('does not depend on the wording, which is the whole defect', () => {
    // The regression the old code could not survive: `capture.ts`'s sentences
    // are prose this project commits to improving, and rewording one used to
    // change where the warning went, with `tsc` clean and nothing thrown.
    // Measured: renaming "page kept painting steadily" to "page painted
    // continuously" flipped `animating` from suppressed to kept.
    //
    // There is no string here to reword. A reason that stopped being routed
    // correctly would have to be renamed in the union, which is a type error
    // at every call site.
    const reasons: UnsettledReason[] = ['animating', 'timeout', 'blank', 'uncovered', 'loading']
    expect(reasons.filter(explainedByCutLoad)).toEqual(['animating', 'timeout'])
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

describe('stitchBands', () => {
  // 2 px wide; each band is 2 rows; the pixel value is the band's number.
  const band = (y: number, n: number, height = 2) => ({ y, width: 2, height, bgra: new Uint8Array(2 * height * 4).fill(n) })
  const rowValue = (out: Uint8Array, row: number): number => out[row * 2 * 4]!

  it('places each band at its row, and leaves unpainted rows white', () => {
    const out = stitchBands(2, 6, [band(0, 1), band(4, 3)])
    expect([0, 1, 2, 3, 4, 5].map(r => rowValue(out, r))).toEqual([1, 1, 255, 255, 3, 3])
  })
  it('an overlapping last band (the scroll clamped) paints the same rows again, and rows past the raster are dropped', () => {
    const out = stitchBands(2, 5, [band(0, 1), band(2, 2), band(3, 3)])
    expect([0, 1, 2, 3, 4].map(r => rowValue(out, r))).toEqual([1, 1, 2, 3, 3])
  })
  it('a band wider than the raster is cropped to it', () => {
    const wide = { y: 0, width: 4, height: 1, bgra: new Uint8Array(4 * 4).fill(9) }
    const out = stitchBands(2, 1, [wide])
    expect(out.length).toBe(8)
    expect(Array.from(out)).toEqual([9, 9, 9, 9, 9, 9, 9, 9])
  })
})

/**
 * espn.com paints white, goes quiet for longer than the settle window, and
 * paints its page a second later; the white came back `settled: true` with no
 * warning on every surface. A quiet frame that is one colour end to end is now
 * given a grace to paint something, and is named blank when it does not.
 */
describe('captureQuiescent on a one-colour frame', () => {
  // The flatness check samples every fourth pixel, so content must land on the grid.
  const W = 8
  const H = 8
  const at = (x: number, y: number, rgba: number[]): FrameMessage => ({
    frame: { x, y, width: 1, height: 1, data: new Uint8Array(rgba) },
    frameWidth: W,
    frameHeight: H,
  })
  it('that stays quiet comes back unsettled, named blank, with its colour in the warning', async () => {
    const warnings: string[] = []
    const got = await captureQuiescent(new FakeSource([fullFrame(W, H, 255)]), {
      settleMs: 20,
      timeoutMs: 2000,
      blankGraceMs: 80,
      onWarn: m => warnings.push(m),
    })
    expect(got.settled).toBe(false)
    expect(got.unsettledReason).toBe('blank')
    expect(warnings.join(' ')).toMatch(/one colour end to end \(#ffffff\) and stayed that way for 80 ms/)
    expect(warnings.join(' ')).toMatch(/settled: false, blank/)
    expect(Array.from(got.bgra.subarray(0, 4))).toEqual([255, 255, 255, 255])
  })
  it('that paints its content within the grace is settled, as before, with no warning', async () => {
    const src = new FakeSource([fullFrame(W, H, 255)])
    setTimeout(() => src.emit('frame', at(4, 4, [0, 0, 0, 255])), 40)
    const warnings: string[] = []
    const got = await captureQuiescent(src, { settleMs: 20, timeoutMs: 2000, blankGraceMs: 400, onWarn: m => warnings.push(m) })
    expect(got.settled).toBe(true)
    expect(got.unsettledReason).toBeUndefined()
    expect(warnings).toEqual([])
    expect(Array.from(got.bgra.subarray((4 * W + 4) * 4, (4 * W + 4) * 4 + 4))).toEqual([0, 0, 0, 255])
  })
  it('a frame with anything on it is not held for the grace', async () => {
    const src = new FakeSource([fullFrame(W, H, 255), at(4, 0, [1, 2, 3, 255])])
    const t0 = Date.now()
    const got = await captureQuiescent(src, { settleMs: 20, timeoutMs: 2000, blankGraceMs: 1500 })
    expect(got.settled).toBe(true)
    expect(Date.now() - t0).toBeLessThan(700)
  })
  it('still one colour at the budget is blank, not timeout', async () => {
    const src = new FakeSource([fullFrame(W, H, 0)])
    const noisy = setInterval(() => src.invalidate(), 10)
    try {
      const warnings: string[] = []
      const got = await captureQuiescent(src, { settleMs: 100, timeoutMs: 250, blankGraceMs: 5000, animationExit: false, onWarn: m => warnings.push(m) })
      expect(got.settled).toBe(false)
      expect(got.unsettledReason).toBe('blank')
      expect(warnings.join(' ')).toMatch(/\(#000000\) and stayed that way for 250 ms/)
    } finally {
      clearInterval(noisy)
    }
  })
})

/**
 * A quiet stretch that straddles a size change — `bug-live-raster-settled-while-resizing`.
 *
 * The capture clears `covered` when a frame at a new size **arrives**, and
 * polls the settle test every 50 ms. Between the last frame of the old size and
 * the first of the new one, `covered` and `lastPaint` both still belong to the
 * old size, so a poll landing there past the settle window returns the previous
 * size's buffer as settled. In the field that is a lottery: probe `35238313231`
 * saw the sequence 16 times in 6 captures and the poll never landed in the gap
 * (1.3 sightings expected, 0 seen). Here the gap is scripted, so it is not.
 */
describe('a quiet stretch that straddles a size change', () => {
  /** Emits its script on a clock, so a gap between two frames is a real gap. */
  class Timed extends EventEmitter {
    constructor(
      private readonly script: { at: number; m: FrameMessage }[],
      private readonly want: { width: number; height: number } | null = null,
    ) {
      super()
    }
    invalidate(): void {
      for (const s of this.script) setTimeout(() => this.emit('frame', s.m), s.at)
    }
    expectedFrameSize(): { width: number; height: number } | null {
      return this.want
    }
  }
  /** Covered at 128x102, silence past the window, then the new size lands. */
  const straddle = (want: { width: number; height: number } | null): Timed =>
    new Timed(
      [
        { at: 0, m: marked(128, 102, 7) },
        { at: 400, m: marked(144, 90, 9) },
        { at: 460, m: marked(144, 90, 9) },
      ],
      want,
    )

  it('comes back at the pre-change size when nothing says a resize is under way', async () => {
    // Not a wish — a record of what the capture can and cannot see. With no
    // expectation to check, silence after a covered frame is silence, and this
    // answer is the only one the frames support. It is also the defect, which
    // is why the fix had to come from the source rather than from here.
    const got = await captureQuiescent(straddle(null), { settleMs: 120, timeoutMs: 5000, ...noGrace, awaitExpectedSize: true })
    expect(got.settled).toBe(true)
    expect([got.width, got.height]).toEqual([128, 102])
  })

  it('waits for the size the source says it is heading for, and settles there', async () => {
    const got = await captureQuiescent(straddle({ width: 144, height: 90 }), {
      settleMs: 120,
      timeoutMs: 5000,
      ...noGrace,
      awaitExpectedSize: true,
    })
    expect(got.settled).toBe(true)
    expect([got.width, got.height]).toEqual([144, 90])
  })

  it('says `resizing` rather than vouching for an earlier size at the budget', async () => {
    // The new size never comes. A budget that ran out is not a settled page,
    // and the sentence names both sizes so the reader knows which PNG this is.
    const src = new Timed([{ at: 0, m: marked(128, 102, 7) }], { width: 144, height: 90 })
    const warnings: string[] = []
    const got = await captureQuiescent(src, {
      settleMs: 120,
      timeoutMs: 600,
      ...noGrace,
      awaitExpectedSize: true,
      onWarn: m => warnings.push(m),
    })
    expect(got.settled).toBe(false)
    expect(got.unsettledReason).toBe('resizing')
    expect([got.width, got.height]).toEqual([128, 102])
    expect(warnings.join(' ')).toContain('this frame is 128x102, not the 144x90 it was asked for')
  })

  it('does not leave by the animating door with the old size either', async () => {
    // Wren's read of the first fix: the settle test was gated and the steady-
    // painting exit was not, so a page painting on at the size the pane had
    // left would come back `animating` carrying that buffer — the same wrong
    // answer wearing a different label. `resizing` is the true one.
    const src = new Timed([{ at: 0, m: marked(128, 102, 7) }], { width: 144, height: 90 })
    const noisy = setInterval(() => src.emit('frame', marked(128, 102, 7)), 20)
    try {
      const got = await captureQuiescent(src, {
        settleMs: 120,
        timeoutMs: ANIMATING_AFTER_MS + 400,
        ...noGrace,
        awaitExpectedSize: true,
      })
      expect(got.settled).toBe(false)
      expect(got.unsettledReason).toBe('resizing')
    } finally {
      clearInterval(noisy)
    }
  })

  it('leaves a caller that did not ask exactly as it was', async () => {
    // The CLI's own captures do not pass the flag, and a source that answers
    // the size must not change their behaviour by existing.
    const got = await captureQuiescent(straddle({ width: 144, height: 90 }), { settleMs: 120, timeoutMs: 5000, ...noGrace })
    expect(got.settled).toBe(true)
    expect([got.width, got.height]).toEqual([128, 102])
  })
})
