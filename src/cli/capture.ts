import type { FrameMessage } from '../shared/api'
import { BLANK_GRACE_MS, blankWarning, isFlatFrame, SETTLE_QUIET_MS } from '../shared/paint'
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
  /**
   * The frame size this source paints at once it has finished resizing, or
   * null when it cannot say. Read only under `awaitExpectedSize`.
   *
   * A capture cannot tell a page that has gone quiet from a surface that has
   * been asked for a new size and has not painted it yet: both are silence
   * after a covered frame. The source can, because it is the one that was
   * asked. See `awaitExpectedSize`.
   */
  expectedFrameSize?(): { width: number; height: number } | null
  /**
   * A counter of the layout changes this source has accepted, or undefined
   * when it does not keep one. Read only under `awaitExpectedSize`.
   *
   * The size alone is not enough: two presets can share a device extent at
   * different densities, and switching between them changes every pixel of
   * the layout without changing one number the capture can see.
   */
  layoutEpoch?(): number

  /**
   * The layout epoch that was bumped **without confirmation**, or `null` when
   * the last bump was confirmed (`bug-live-raster-text-scale-mid-capture`).
   *
   * `TargetSource.confirmTextScaleLanded` waits up to a second for the page to
   * show the new text scale and then bumps the epoch either way — a rescued
   * answer beats a hang. A rescued bump is indistinguishable from a real one
   * at the frame level, so a capture settling under it may be showing the
   * layout from *before* the scale change. Measured 0-7 ms across 17 live
   * samples against a 1 s budget, so this is narrow, not routine — but the
   * capture must not report `settled: true` about it in silence, which is what
   * the card's acceptance and `release-gate.md`'s escape hatch both require.
   */
  unconfirmedLayoutEpoch?(): number | null
}

/**
 * Why a capture is not settled: `animating` — the frame was covered and the
 * page kept painting at a steady rate, so the capture was taken early rather
 * than at the budget; `timeout` — covered, still painting at the budget;
 * `uncovered` — the budget ran out with pixels never painted; `blank` — the
 * frame went quiet one colour end to end and stayed that way through the
 * grace: the page's background with nothing on it yet, or a page that really
 * is empty, and either way not a picture to vouch for. `loading` is not this
 * module's finding but the render's: the page load outran the budget (under
 * a throttle, a slow load is the point), and the frame is what had painted by
 * then — quiet or not, it is not the settled page, and `settledMs` is null.
 * `resizing` — the surface was still on its way to the size it was asked for
 * when the budget ran out, so the frame in hand is of some earlier size; only
 * a caller that passes `awaitExpectedSize` can get it (see below).
 */
export type UnsettledReason = 'animating' | 'timeout' | 'uncovered' | 'blank' | 'loading' | 'resizing'

/**
 * After a load the budget cut short, which capture warnings say nothing the
 * load warning has not already said.
 *
 * `animating` and `timeout` both mean *the page was still painting when we
 * stopped waiting* — which is what a cut-short load is. Saying it twice adds
 * a sentence and no fact. `blank` and `uncovered` are claims about the raster
 * itself: the frame is one colour, or pixels never arrived. A cut-short load
 * does not account for either, and dropping them would lose the only sentence
 * saying the image is not what it appears to be.
 *
 * This lived in `main.ts` as `/kept painting/.test(message)` — the product
 * matching its own prose, which `compatibility.md` forbids callers from doing
 * and `CONTRIBUTING.md` commits us to breaking by rewording warnings whenever
 * they get clearer. Measured: renaming "page kept painting steadily" to "page
 * painted continuously" moved `animating` from suppressed to kept, with `tsc`
 * clean and nothing thrown. Keyed on the reason there is no wording to break,
 * and a renamed reason is a type error at every call site.
 *
 * A `switch` with a `never` default rather than a boolean expression, so that
 * adding a reason to the union does not compile until someone has decided
 * which side of this it falls on. The old regex silently treated every new
 * reason as "keep"; a comparison chain would do the same quietly.
 *
 * The default does not throw, which is Henry's correction to the first version
 * of this. The exhaustiveness is entirely the `never` assignment's doing, at
 * compile time; a throw adds nothing to it and makes a *warning router* able
 * to take down a capture. And the safe answer for an unclassifiable warning is
 * not to crash — it is to let the sentence through. This whole card is about a
 * warning going missing quietly, so a router that cannot place one should err
 * towards saying it.
 */
export function explainedByCutLoad(reason: UnsettledReason | undefined): boolean {
  switch (reason) {
    case 'animating':
    case 'timeout':
      return true
    case 'blank':
    case 'uncovered':
    case 'loading':
    // A load the budget cut short says nothing about the surface's size, and
    // the resize sentence names sizes the load warning never mentions. It is
    // also unreachable from here today — only a caller passing
    // `awaitExpectedSize` can produce it, and the CLI does not — but the
    // routing is what keeps that true by construction rather than by memory.
    case 'resizing':
    case undefined:
      return false
    default: {
      // Unreachable while the union is routed above — the assignment is the
      // compile-time check. At runtime, keep the warning.
      const unrouted: never = reason
      void unrouted
      return false
    }
  }
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
  /** Present when `settled` is false. */
  unsettledReason?: UnsettledReason
  /**
   * The frame settled under a layout epoch its source could not confirm, so it
   * may show the layout from before the last text-scale change. `settled` stays
   * true — the paints really did go quiet — and the caller is told anyway.
   */
  scaleUnconfirmed?: true
}

export interface CaptureOptions {
  /** Paint silence that counts as "settled" (default 400 ms). */
  settleMs?: number
  /** Overall budget; an animating page is captured as-is at this bound. */
  timeoutMs?: number
  /**
   * Called with the sentence and the reason it was raised for. The reason is
   * what a caller should route on: the sentence is prose and gets reworded
   * (see `explainedByCutLoad`). Not part of any output: the CLI consumes the
   * reason at the routing site and puts only the message in `warnings[]`, so
   * no MCP schema gains a field.
   */
  onWarn?: (message: string, reason: UnsettledReason) => void
  /**
   * Checked every poll: a returned error aborts the capture immediately —
   * how a renderer crash mid-capture fails fast instead of burning the
   * timeout and reporting a misleading "no full frame painted".
   */
  failure?: () => Error | null
  /**
   * Capture early once the frame is covered and paints keep arriving at a
   * steady rate (default true): an animating page never goes quiet, and
   * waiting the whole budget to learn that cost thirty seconds per render
   * on a page with a moving hero — every render of a report. Off under a
   * throttle, where `settledMs` is the measurement and a page loading
   * slowly over 3G paints steadily too.
   */
  animationExit?: boolean
  /**
   * Refuse to settle on a frame whose size is not the one the source says it
   * is heading for (default false; needs `FrameEmitter.expectedFrameSize`).
   *
   * **The defect this exists for, measured.** `covered` is cleared when a frame
   * at a new size *arrives*, and the settle test is polled every 50 ms. Between
   * the last frame at the old size and the first at the new one, `covered` and
   * `lastPaint` both still belong to the old size — so a poll landing in that
   * gap, past the settle window, returns the **previous** size's buffer with
   * `settled: true` and no warning. A live raster taken while the pane changed
   * preset came back exactly that way, twice
   * (`bug-live-raster-settled-while-resizing`); probe `35238313231` caught the
   * frame sequence 16 times in 6 captures, and `cliCapture.test.ts` scripts it.
   *
   * The capture cannot see this from the frames alone: a surface that has been
   * asked for a new size and has not painted it is silence after a covered
   * frame, and so is a page that has finished. Only the source knows it was
   * asked. When the budget runs out having never reached that size the capture
   * comes back `resizing` rather than pretending.
   */
  awaitExpectedSize?: boolean
  /**
   * How long a quiet frame that is one colour end to end is given to paint
   * something before it is returned as blank (default `BLANK_GRACE_MS`).
   */
  blankGraceMs?: number
}

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

export const DEFAULT_SETTLE_MS = SETTLE_QUIET_MS

/**
 * A covered frame that has kept painting for this long, with at least this
 * many paints, is animating: capture now. Two seconds and eight paints is
 * four frames a second sustained — a CSS animation or a video, not a page
 * still loading, whose paints arrive in bursts with quiet gaps between.
 */
export const ANIMATING_AFTER_MS = 2_000
export const ANIMATING_MIN_PAINTS = 8


/**
 * Ground truth for "did every pixel actually paint", read from the buffer's
 * own alpha byte rather than the mask `onFrame` maintains. The mask can be
 * wrong: its full-rect fast path (`onFrame`, the `x === 0 && y === 0 && w ===
 * width && h === height` branch) accepts a whole-buffer repaint as fully
 * covered without inspecting its bytes, and Chromium was observed doing
 * exactly that mid-composite (bug-raster-coverage-counts-transparent-rows,
 * Idris's two-level reproduction). The buffer starts zero-filled BGRA, so an
 * unpainted pixel reads alpha 0 and real content never does (the composited
 * frame is opaque — see `targetSource.ts`'s `BrowserWindow` construction),
 * which makes "any alpha-0 pixel" true of the bytes regardless of what the
 * mask believes.
 *
 * Unconditionally O(width x height): the mask-based bounds finder this
 * replaced could exit early on the first row/column with a gap, because it
 * only ever ran once a gap was already known to exist. This one runs on
 * every capture, including the overwhelmingly common fully-painted case,
 * where there is nothing to find early — a fully-opaque buffer is the worst
 * case, not the best one, for this scan.
 *
 * Measured (Node, warmed up, 200-iteration average), a fully-opaque
 * 1920x1080 buffer — 2,073,600 px, worst case, no early exit possible: 2.0
 * ms/scan. With a 180-row transparent band present: 2.4 ms/scan. Not free,
 * but not a budget-relevant cost against a capture whose own timeouts run in
 * seconds — see the board card's scan-cost acceptance item.
 */
function transparentBoundsFromBytes(
  buffer: Uint8Array,
  width: number,
  height: number,
): { count: number; box: { x: number; y: number; width: number; height: number } } | null {
  let count = 0
  let minX = width
  let maxX = -1
  let minY = height
  let maxY = -1
  for (let y = 0; y < height; y++) {
    const rowBase = y * width
    for (let x = 0; x < width; x++) {
      if (buffer[(rowBase + x) * 4 + 3] === 0) {
        count++
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        maxY = y
      }
    }
  }
  if (count === 0) return null
  return { count, box: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 } }
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
  const blankGraceMs = options.blankGraceMs ?? BLANK_GRACE_MS

  let width = 0
  /** When a covered frame first went quiet as one flat colour; the grace counts from here. */
  let blankSince = 0
  let height = 0
  let buffer = new Uint8Array(0)
  let covered = false
  /** Per-pixel paint accounting; freed the moment coverage completes. */
  let mask: Uint8Array | null = null
  let uncovered = 0
  let lastPaint = Date.now()
  /** Any pixels at all? The difference between a rescue and a hard failure. */
  let frames = 0
  /** When coverage completed, and the paints since: the animation test's evidence. */
  let coveredAt = 0
  let paintsSinceCovered = 0
  /** Which layout the pixels in hand belong to; undefined when nobody is counting. */
  let frameEpoch: number | undefined

  /** The source's layout counter, read only when the caller asked us to wait on it. */
  const epochNow = (): number | undefined => (options.awaitExpectedSize === true ? source.layoutEpoch?.() : undefined)

  const onFrame = (m: FrameMessage): void => {
    lastPaint = Date.now()
    frames++
    if (covered) paintsSinceCovered++
    const epoch = epochNow()
    const resized = m.frameWidth !== width || m.frameHeight !== height
    // A layout change the size cannot show (a density change at the same
    // device extent) starts coverage again exactly as a resize does. The
    // buffer is replaced rather than kept, so that whatever the new layout has
    // not painted reads as never painted: keeping it would leave the previous
    // layout's pixels under a frame reported as this one's, and `uncovered`'s
    // sentence is checked against the transparent pixels in the PNG.
    if (resized || epoch !== frameEpoch) {
      width = m.frameWidth
      height = m.frameHeight
      buffer = new Uint8Array(width * height * 4)
      covered = false
      mask = new Uint8Array(width * height)
      uncovered = width * height
      frameEpoch = epoch
    }
    const { x, y, width: w, height: h, data } = m.frame
    if (x === 0 && y === 0 && w === width && h === height) {
      buffer.set(data)
      if (!covered) {
        covered = true
        coveredAt = lastPaint
        paintsSinceCovered = 0
      }
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
        coveredAt = lastPaint
        paintsSinceCovered = 0
        mask = null
      }
    }
  }

  /**
   * Is the frame in hand the size the source is heading for? True whenever the
   * caller did not ask, or the source cannot say — this gate only ever holds a
   * capture back, and never on a source that has not opted in.
   */
  const atExpectedSize = (): boolean => {
    if (options.awaitExpectedSize !== true) return true
    if (epochNow() !== frameEpoch) return false
    const want = source.expectedFrameSize?.() ?? null
    return want === null || (want.width === width && want.height === height)
  }

  source.on('frame', onFrame)
  try {
    source.invalidate()
    let settled = true
    let unsettledReason: UnsettledReason | undefined
    /** Set at the settle decision, where the epoch provably matches the frame. */
    let rescued = false
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const failed = options.failure?.()
      if (failed) throw failed
      if (covered && Date.now() - lastPaint >= settleMs && atExpectedSize()) {
        // Read HERE, not at the return. `atExpectedSize()` has just confirmed
        // `layoutEpoch() === frameEpoch`, so this is the one moment the source's
        // answer provably describes the frame in hand. `unconfirmedEpoch` is a
        // single mutable field holding only the most recent bump, and a
        // `setTextScale` completing between this decision and the return would
        // overwrite it — losing the disclosure rather than misplacing it
        // (@Kenya, reviewing #388). The window is small; it is also free to close.
        rescued = options.awaitExpectedSize === true && frameEpoch !== undefined && source.unconfirmedLayoutEpoch?.() === frameEpoch
        // Quiet. A frame that is one colour end to end is the page's
        // background, not the page: espn.com paints white, goes quiet for
        // longer than the settle window, and paints its content a second
        // later. Give it the grace to paint something; still flat after
        // that, it comes back unsettled and says so, since a one-colour
        // picture is never a real answer.
        if (!isFlatFrame(buffer, width, height)) break
        if (blankSince === 0) blankSince = Date.now()
        if (Date.now() - blankSince >= blankGraceMs) {
          settled = false
          unsettledReason = 'blank'
          options.onWarn?.(blankWarning(buffer, blankGraceMs), 'blank')
          break
        }
      }
      // Covered and painting steadily: it will not go quiet, and the frame
      // in hand is as good as the one at the budget.
      if (
        options.animationExit !== false &&
        covered &&
        // Gated for the same reason the settle test is (Wren's read): coverage
        // earned at the size the pane has left is still coverage, so a page
        // painting steadily at the OLD size would exit here with the old
        // buffer, labelled `animating`. Same wrong answer, different word.
        atExpectedSize() &&
        Date.now() - coveredAt >= ANIMATING_AFTER_MS &&
        paintsSinceCovered >= ANIMATING_MIN_PAINTS
      ) {
        settled = false
        unsettledReason = 'animating'
        options.onWarn?.(
          `page kept painting steadily for ${ANIMATING_AFTER_MS} ms after its first full frame (animation or video); capturing the current frame`,
          'animating',
        )
        break
      }
      if (Date.now() >= deadline) {
        settled = false
        if (covered && !atExpectedSize()) {
          // Never reached the size it was asked for. Said before the painting
          // and blank readings below, because it is the more specific fact:
          // whatever the pixels are, they are of some earlier size, and that
          // is what a reader has to know about the PNG in front of them.
          unsettledReason = 'resizing'
          const want = source.expectedFrameSize?.() ?? null
          // Two ways to be late, and they need different words. A different
          // size says itself. The SAME size at a new density does not: the
          // PNG's dimensions are the ones that were asked for, so a reader
          // comparing them would conclude the frame is current. Say that the
          // dimensions cannot be used, rather than printing "not the 1920x1080
          // it was asked for" about a 1920x1080 frame.
          const sameExtent = want !== null && want.width === width && want.height === height
          options.onWarn?.(
            sameExtent
              ? `the target was still changing when the capture budget ran out; this frame is from before the change, and its ${width}x${height} is the size that was asked for, so the dimensions do not show it`
              : `the target was still resizing when the capture budget ran out; this frame is ${width}x${height}` +
                  (want === null ? '' : `, not the ${want.width}x${want.height} it was asked for`),
            'resizing',
          )
          break
        }
        if (covered) {
          // Still painting at the budget — and if every paint left it one
          // colour, blank is the more useful word for what came back.
          if (isFlatFrame(buffer, width, height)) {
            unsettledReason = 'blank'
            options.onWarn?.(blankWarning(buffer, timeoutMs), 'blank')
          } else {
            unsettledReason = 'timeout'
            options.onWarn?.(`page kept painting for ${timeoutMs} ms (animation?); capturing the current frame`, 'timeout')
          }
          break
        }
        if (frames === 0 || width === 0 || height === 0) {
          throw new Error(`no frame painted within ${timeoutMs} ms`)
        }
        // The mask's own count and uncoveredBounds(mask, ...) used to answer
        // this directly. They still could here — mask is non-null and
        // uncovered > 0 by construction of this branch — but the bytes check
        // below is now the single source of truth for the message, so this
        // branch only has to name the reason.
        unsettledReason = 'uncovered'
        break
      }
      await sleep(Math.min(50, settleMs))
    }
    // Ground truth, checked once regardless of which branch above set
    // `settled`/`unsettledReason`: the mask (and the `covered` flag it feeds)
    // can be wrong. onFrame's full-rect fast path accepts a whole-buffer
    // repaint as fully covered without inspecting its bytes — Chromium can
    // and does deliver a "full" rect mid-composite (bug-raster-coverage-
    // counts-transparent-rows) — so `covered` can read true, and every branch
    // above that trusts it (the quiet-settle exit, animating, resizing,
    // blank-or-timeout at the deadline) can hand back a buffer that still has
    // fully transparent pixels the mask never saw. A capture's own buffer
    // starts zero-filled BGRA, so an unpainted pixel is alpha 0 by
    // construction — real content is never alpha 0 (the composited frame is
    // opaque; see targetSource.ts) — making "any alpha-0 pixel" an
    // unconditional, mask-independent fact about what actually painted.
    const transparent = transparentBoundsFromBytes(buffer, width, height)
    if (transparent) {
      settled = false
      unsettledReason = 'uncovered'
      const total = width * height
      options.onWarn?.(
        `${((transparent.count / total) * 100).toFixed(1)}% of the ${width}x${height} frame ` +
          `never painted within ${timeoutMs} ms ` +
          `(uncovered region ${transparent.box.width}x${transparent.box.height} at ${transparent.box.x},${transparent.box.y}); ` +
          `those pixels are transparent, not page content. ` +
          `Returning the frame as captured (settled: false)`,
        'uncovered',
      )
    }
    // Disclosed on a SETTLED frame, which is the whole point: the paints did go
    // quiet, so `settled` is honest, and the epoch they went quiet under was a
    // rescued one, so the picture may predate the scale change. Reported only
    // when the source opted into epochs at all, and only for the exact epoch
    // this frame settled under — a later confirmed bump must not inherit it.
    // Not routed through `onWarn`: its signature takes an `UnsettledReason`,
    // because a warning there accompanies a capture that did NOT settle. This
    // one did — the paints went quiet honestly — so the disclosure travels as a
    // field and the reply layer turns it into a sentence. Inventing a reason to
    // reuse that channel would make the capture say something false about
    // itself to say something true about the scale.
    return {
      width,
      height,
      bgra: buffer.slice(),
      settled,
      ...(settled ? {} : { unsettledReason }),
      ...(rescued ? { scaleUnconfirmed: true as const } : {}),
    }
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

/** One captured band of a taller page, placed at a device-pixel row. */
export interface CaptureBand {
  /** Where the band's top row sits in the stitched raster, in device px. */
  y: number
  width: number
  height: number
  /** BGRA, row-major, as `captureQuiescent` returns it. */
  bgra: Uint8Array
}

/**
 * Stitches bands captured by scrolling into one raster of the given size.
 * Rows no band painted are left white (a page's own default), and a band
 * that overlaps the previous one — the last band, since a scroll clamps at
 * the bottom — simply paints the same pixels again. Pure, unit-tested; the
 * scrolling and capturing that produce the bands live in the CLI.
 */
export function stitchBands(width: number, height: number, bands: CaptureBand[]): Uint8Array {
  const out = new Uint8Array(width * height * 4).fill(0xff)
  for (const b of bands) {
    const cols = Math.min(width, b.width)
    for (let row = 0; row < b.height; row++) {
      const y = b.y + row
      if (y < 0 || y >= height) continue
      const src = row * b.width * 4
      out.set(b.bgra.subarray(src, src + cols * 4), y * width * 4)
    }
  }
  return out
}
