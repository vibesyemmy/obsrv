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
 * The uncovered region's bounding box, for the rescue warning: "which part of
 * the frame never painted" is the one thing that makes an unsettled capture
 * actionable. Null when everything is covered.
 *
 * Four directional scans with early exit rather than one sweep of the whole
 * raster: each edge stops at the first line that contains an uncovered pixel,
 * so a region touching an edge — which is what an unfinished repaint almost
 * always leaves — costs O(width + height) instead of O(width x height). That
 * matters on `--full-page` at dsf 3, where the full sweep is tens of millions
 * of iterations on an already-slow path. A single uncovered pixel dead centre
 * still degenerates to the old cost; it is one pass either way.
 */
function uncoveredBounds(mask: Uint8Array, width: number, height: number): { x: number; y: number; width: number; height: number } | null {
  const rowHasGap = (y: number): boolean => {
    const row = y * width
    for (let x = 0; x < width; x++) if (mask[row + x] === 0) return true
    return false
  }
  let y0 = -1
  for (let y = 0; y < height; y++) {
    if (rowHasGap(y)) {
      y0 = y
      break
    }
  }
  if (y0 < 0) return null
  let y1 = y0
  for (let y = height - 1; y > y0; y--) {
    if (rowHasGap(y)) {
      y1 = y
      break
    }
  }
  const columnHasGap = (x: number): boolean => {
    for (let y = y0; y <= y1; y++) if (mask[y * width + x] === 0) return true
    return false
  }
  let x0 = 0
  while (x0 < width && !columnHasGap(x0)) x0++
  let x1 = width - 1
  while (x1 > x0 && !columnHasGap(x1)) x1--
  return { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 }
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

  const onFrame = (m: FrameMessage): void => {
    lastPaint = Date.now()
    frames++
    if (covered) paintsSinceCovered++
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
    const want = source.expectedFrameSize?.() ?? null
    return want === null || (want.width === width && want.height === height)
  }

  source.on('frame', onFrame)
  try {
    source.invalidate()
    let settled = true
    let unsettledReason: UnsettledReason | undefined
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const failed = options.failure?.()
      if (failed) throw failed
      if (covered && Date.now() - lastPaint >= settleMs && atExpectedSize()) {
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
          options.onWarn?.(
            `the target was still resizing when the capture budget ran out; this frame is ${width}x${height}` +
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
        unsettledReason = 'uncovered'
        const total = width * height
        const box = mask ? uncoveredBounds(mask, width, height) : null
        // Name what those pixels *are*, not just where: the buffer starts
        // zero-filled, so an unpainted region is fully transparent BGRA
        // (0,0,0,0) — which an agent could otherwise read as a black or blank
        // band of the page.
        options.onWarn?.(
          `${((uncovered / total) * 100).toFixed(1)}% of the ${width}x${height} frame ` +
            `never painted within ${timeoutMs} ms` +
            (box ? ` (uncovered region ${box.width}x${box.height} at ${box.x},${box.y})` : '') +
            `; those pixels are transparent, not page content. ` +
            `Returning the frame as captured (settled: false)`,
          'uncovered',
        )
        break
      }
      await sleep(Math.min(50, settleMs))
    }
    return { width, height, bgra: buffer.slice(), settled, ...(settled ? {} : { unsettledReason }) }
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
