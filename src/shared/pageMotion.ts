/**
 * Whether the page held still while it was measured.
 *
 * `snap` answers `settled: false, unsettledReason: 'animating'` on a page
 * that keeps painting; `audit` and `lint` measured the same page and said
 * nothing at all. On stripe.com that silence covered finding boxes moving up
 * to 438 CSS px between runs — 96 of 97 findings, on coordinates `report`
 * pins to a screenshot (B5, docs/research/2026-09-14-b5-repeatability.md).
 *
 * A paint verdict alone is the wrong thing to repeat here. A playing video
 * and an opacity fade paint steadily without moving a single box, and a
 * measurement of that page is perfectly repeatable; a carousel or a transform
 * animation moves the boxes themselves. Both answer `animating`, so this
 * keys off its own measurement instead: the elements are asked a second time,
 * and the note speaks only about what actually moved.
 */

export interface MeasuredBox {
  element: string
  rect: { x: number; y: number; width: number; height: number }
}

export interface PageMotion {
  /** Elements found in both passes whose box moved. */
  moved: number
  /** Elements found in both passes at all — the denominator. */
  compared: number
  /** The largest distance any one of them travelled, in CSS px. */
  maxPx: number
  /** Elements in one pass and not the other: the page replaced content, not just moved it. */
  changed: number
}

/**
 * Sub-pixel jitter is not motion. Chromium reports fractional boxes and a
 * re-measure of a still page can differ in the last place; a carousel moves
 * by hundreds. One px is comfortably clear of the first and far below the
 * second.
 */
export const MOTION_FLOOR_PX = 1

/**
 * How long to leave between the two passes, measured on stripe.com — the page
 * that exposed this — at 0, 250, 1000, 2000 and 4000 ms:
 *
 * | gap     | moved     | furthest  |
 * |---------|-----------|-----------|
 * | 18 ms   | 28 / 916  | 1.0 px    |
 * | 271 ms  | 30 / 916  | 18 px     |
 * | 1020 ms | 31 / 916  | 83 px     |
 * | 4024 ms | 231 / 914 | 10,156 px |
 *
 * Back to back is not enough: the same page answered 28 moved on one run and
 * 0 on another, because what creeps had not yet crept a whole pixel. At 250 ms
 * it is solid, and the second pass itself costs 15 ms on a 901-element page —
 * the wait is the whole price, against a walk that already takes seconds.
 *
 * The 4 s row is the honest limit of this: a page also moves in jumps this
 * window cannot see (a carousel that steps, a section that loads late). The
 * note therefore says what it measured over its own interval, and **silence
 * is not a promise that the page is still** — a limitation that belongs in
 * the limitations page, not in a sentence this probe has no evidence for.
 */
export const MOTION_PROBE_MS = 250

/**
 * Measure the page twice, `waitMs` apart, and say what moved. Null when the
 * second pass found nothing to compare — the page stopped answering, which
 * the caller's own timeout note covers.
 *
 * `sleep` is injected so this is testable without waiting.
 */
export async function motionAfter<T>(
  before: MeasuredBox[],
  remeasure: () => Promise<T | null>,
  boxesOf: (report: T) => MeasuredBox[],
  waitMs: number = MOTION_PROBE_MS,
  sleep: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms)),
  now: () => number = Date.now,
): Promise<(PageMotion & { afterMs: number }) | null> {
  const at = now()
  await sleep(waitMs)
  const again = await remeasure()
  if (again === null) return null
  // The interval the numbers are over, measured rather than quoted: a caller
  // that reuses another probe's wait has a longer one than the constant, and
  // the sentence is owed the real figure.
  return { ...boxesMoved(before, boxesOf(again)), afterMs: now() - at }
}

/**
 * Pair the two passes by element and ordinal — `div.card` occurs many times
 * and the nth is the nth — and compare the boxes. Pure, so it is tested.
 */
export function boxesMoved(before: MeasuredBox[], after: MeasuredBox[]): PageMotion {
  const index = (boxes: MeasuredBox[]): Map<string, MeasuredBox> => {
    const seen = new Map<string, number>()
    const out = new Map<string, MeasuredBox>()
    for (const b of boxes) {
      const n = seen.get(b.element) ?? 0
      seen.set(b.element, n + 1)
      out.set(`${b.element}#${n}`, b)
    }
    return out
  }
  const a = index(before)
  const b = index(after)
  let moved = 0
  let compared = 0
  let maxPx = 0
  for (const [key, box] of a) {
    const other = b.get(key)
    if (other === undefined) continue
    compared++
    const d = Math.max(Math.abs(box.rect.x - other.rect.x), Math.abs(box.rect.y - other.rect.y))
    if (d >= MOTION_FLOOR_PX) {
      moved++
      maxPx = Math.max(maxPx, d)
    }
  }
  // Counted from both sides: an element that left and one that arrived are
  // each a page that rewrote itself rather than moved.
  const changed = a.size - compared + (b.size - compared)
  return { moved, compared, maxPx, changed }
}

/**
 * The boxes each measurement already holds, so the second pass compares the
 * same elements the answer is built from rather than a sample of its own.
 * Both adapters take the report, not the finished result: a finding that fell
 * below a threshold still moved, and a page whose findings all vanished
 * between passes moved most of all.
 */
export function auditBoxes(report: { targets: MeasuredBox[]; text: MeasuredBox[] }): MeasuredBox[] {
  return [...report.targets, ...report.text]
}

export function lintBoxes(report: { text: MeasuredBox[]; edges: MeasuredBox[]; images: MeasuredBox[] }): MeasuredBox[] {
  return [...report.text, ...report.edges, ...report.images]
}

/**
 * What to tell the reader, or null when the page held still.
 *
 * Null on a page that kept painting without moving anything is deliberate:
 * the figures are repeatable, so there is nothing to warn about, and a
 * sentence that fires on every page with a video would teach the reader to
 * skip it. This says its own subject and keys off its own numbers.
 */
export function pageMovedNote(what: 'audit' | 'lint', motion: PageMotion, afterMs: number): string | null {
  if (motion.moved === 0 && motion.changed === 0) return null
  const parts: string[] = []
  if (motion.moved > 0) {
    parts.push(
      `${motion.moved} of the ${motion.compared} element${motion.compared === 1 ? '' : 's'} re-measured had moved, ` +
        `by up to ${Math.round(motion.maxPx)} CSS px`,
    )
  }
  if (motion.changed > 0) {
    parts.push(`${motion.changed} had been replaced`)
  }
  return (
    `this page was still moving when it was measured: ${parts.join(', and ')} in the ${afterMs} ms after the ` +
    `figures were taken — a carousel, a slideshow, a transform animation. The ${what} is of one moment, and the ` +
    `boxes are where those elements were at it: a repeat run will not agree on them, and a before-and-after that ` +
    `compares them is reading the page's own movement as change`
  )
}
