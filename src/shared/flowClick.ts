/**
 * Clicking a flow step's target by selector, as three commands that already
 * exist.
 *
 * **Why this is a join and not new input plumbing** (`feat-flow-selector-click`).
 * `inspect` takes a selector and answers with the element's box; `click` takes
 * CSS-pixel coordinates and nothing else. So a flow could *locate* the checkout
 * button and could not *press* it, and `validateFlow` accepted
 * `{action: 'click', target: '.checkout'}` while the control server answered 400
 * one layer down. Everything needed to close that was already on the wire.
 *
 * **The middle step is why this is a card.** An element below the fold has a
 * `rect.y` outside the viewport, and `click` correctly refuses it — *"outside the
 * current CSS viewport WxH"* — a refusal that reads like a broken selector when
 * the selector was right and the page simply had not scrolled. So the join is
 * locate, **scroll into view**, then press.
 *
 * The decisions live here as pure functions over the two rects and the viewport,
 * so they are testable without an app: the runner supplies the round-trips and
 * this file supplies the arithmetic and the refusals.
 */

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

export interface Viewport {
  width: number
  height: number
}

/**
 * Where a scrolled-to element is placed in the viewport: one third down rather
 * than flush against the top edge.
 *
 * Flush would be arithmetically simpler and worse. A sticky header is the
 * commonest piece of furniture on a page a QA flow drives, and an element
 * scrolled to `y = 0` lands **under** it — so the click reaches the header, the
 * flow reports a press that did nothing, and nothing in the reply says why. A
 * third down clears ordinary chrome without depending on knowing its height,
 * which nothing here can measure.
 */
export const SCROLL_PLACEMENT = 1 / 3

/** The current scroll offset, derived rather than fetched: `pageRect` is the
 *  same box with the scroll added, so the difference *is* the offset. One
 *  round-trip fewer, and it cannot disagree with the rects it is computed
 *  from — a separately-read offset can, whenever the page moves between the
 *  two reads. */
export function scrollOffsetOf(rect: Box, pageRect: Box): { x: number; y: number } {
  return { x: pageRect.x - rect.x, y: pageRect.y - rect.y }
}

/** Whether the box is wholly inside the viewport. The strict `<` on the far
 *  edges matches `parseClick`, which refuses `x >= viewport.width`: a box whose
 *  right edge is exactly the viewport width has its last column off-screen. */
export function isWhollyVisible(rect: Box, viewport: Viewport): boolean {
  return rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= viewport.width && rect.y + rect.height <= viewport.height
}

/**
 * The scroll offset that brings the element into view, in page pixels.
 *
 * Only the axis that is actually off-screen moves. An element below the fold in
 * a page that is also scrolled sideways should not be dragged back to `x: 0` —
 * that is a second change the caller did not ask for, and on a horizontally
 * paginated layout it changes which section the flow is in.
 *
 * **Two units meet here, and the text scale is what tells them apart**
 * (`bug-selector-click-over-scrolls-under-text-scale`). `rect` and `viewport` are in surface px: under a
 * text scale `k` the page lays out `k` times smaller and `inspect` multiplies its box by `k`. `scroll`
 * takes **page** px. The offset `at` is page px already, because `pageRect` is `rect` plus the page's
 * scroll and the difference cancels the surface part out. So the distance still to travel — how far the
 * element sits from where it should be, `rect - extent / 3`, in surface px — has to be divided by `k`
 * before it is added to where the page already is. Ignoring `k` aimed at `3324 - 284 = 3040` page px for an
 * element 2216 page px down at `k = 1.5`, and the page ended 1236 surface px past it. At `k = 1` the
 * division changes nothing, which is every flow before this one.
 */
export function scrollToShow(rect: Box, pageRect: Box, viewport: Viewport, textScale = 1): { x: number; y: number } {
  const at = scrollOffsetOf(rect, pageRect)
  const offVertically = rect.y < 0 || rect.y + rect.height > viewport.height
  const offHorizontally = rect.x < 0 || rect.x + rect.width > viewport.width
  const place = (rectPos: number, scrollNow: number, extent: number): number =>
    Math.max(0, Math.round(scrollNow + (rectPos - extent * SCROLL_PLACEMENT) / textScale))
  return {
    x: offHorizontally ? place(rect.x, at.x, viewport.width) : at.x,
    y: offVertically ? place(rect.y, at.y, viewport.height) : at.y,
  }
}

/**
 * The point to click: the centre of the part of the element that is **on the
 * screen**, not the centre of the element.
 *
 * They differ for a box that straddles an edge — a wide sticky bar, a list item
 * cut off at the fold after a scroll that could not go further — and for those
 * the element's own centre can be a coordinate `click` refuses while the element
 * is plainly visible and pressable. The visible centre is also what a person
 * would click, which is the behaviour a flow is standing in for.
 *
 * Null when the intersection is empty: there is no honest point then, and
 * inventing a clamped one would press whatever *is* at the edge.
 */
export function visibleCentre(rect: Box, viewport: Viewport): { x: number; y: number } | null {
  const left = Math.max(0, rect.x)
  const top = Math.max(0, rect.y)
  const right = Math.min(viewport.width, rect.x + rect.width)
  const bottom = Math.min(viewport.height, rect.y + rect.height)
  if (right <= left || bottom <= top) return null
  // Floored, because `parseClick` refuses `x >= viewport.width` and a centre
  // computed on the far edge of a full-width element lands exactly there.
  const x = Math.min(Math.floor((left + right) / 2), viewport.width - 1)
  const y = Math.min(Math.floor((top + bottom) / 2), viewport.height - 1)
  return { x, y }
}

/**
 * The points worth trying inside an element's box, best first.
 *
 * **Why more than one, measured rather than reasoned** (`bug-selector-click-presses-the-gap`,
 * 2026-09-30). The border box of a **wrapped inline** element — a link whose text runs to two lines —
 * is the union of its line boxes **plus the leading between them**, and that gap paints as the parent
 * block, not as the link. Measured on `books.toscrape.com` at 360 px: line 1 ends at 531.2, line 2
 * starts at 534.2, the union box runs 514.2–551.2, and its centre, 532.7, sits strictly inside the
 * 3 px gap where `elementFromPoint` answers `<h3>`. So the centre — the one point the first version
 * tried — is exactly the point such an element does not paint.
 *
 * The first candidate is still the centre, because for a block element it is the best point and the
 * commonest case. The rest walk the box's quarters, which for a two-line link land inside line 1 and
 * line 2, and for a short final line reach leftward rather than assuming the text fills the width.
 *
 * Ordered, deduplicated, and each one inside the visible part of the box — a candidate outside the
 * viewport is a coordinate `click` refuses, which is the other half of this file's job.
 */
export function candidatePoints(rect: Box, viewport: Viewport): Array<{ x: number; y: number }> {
  const left = Math.max(0, rect.x)
  const top = Math.max(0, rect.y)
  const right = Math.min(viewport.width, rect.x + rect.width)
  const bottom = Math.min(viewport.height, rect.y + rect.height)
  if (right <= left || bottom <= top) return []
  const w = right - left
  const h = bottom - top
  const at = (fx: number, fy: number): { x: number; y: number } => ({
    x: Math.min(Math.floor(left + w * fx), viewport.width - 1),
    y: Math.min(Math.floor(top + h * fy), viewport.height - 1),
  })
  const points = [
    at(0.5, 0.5), // the centre: right for a block, and the case that already worked
    at(0.5, 0.25), // inside the first line of a two-line inline
    at(0.5, 0.75), // inside the last line
    at(0.25, 0.25), // a first line that starts left of centre
    at(0.25, 0.75), // a short final line, which centre-x can overshoot entirely
  ]
  const seen = new Set<string>()
  return points.filter(p => {
    const key = `${p.x},${p.y}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * Why a selector could not be clicked, in the caller's words.
 *
 * **Each case names which of the two it was**, because "click failed" is the
 * answer this whole card exists to stop: a selector that matches nothing, an
 * element that matches but has no area, and an element that could not be brought
 * into view are three different things for whoever is reading the report, and
 * they act on each differently. `inspect`'s own notes already separate "not a
 * valid CSS selector" from "not on this page" (`inspectReadout.ts:226`), so they
 * are carried through rather than restated here.
 */
export function noMatchRefusal(selector: string, notes: string[]): string {
  const said = notes.length > 0 ? ` — ${notes.join(' ')}` : ''
  return `no element matches ${JSON.stringify(selector)}, so there is nothing to click${said}`
}

/**
 * **The reason comes from `inspect`'s own notes, not from a field.**
 *
 * The first version of this read `readout.hidden` and there is no such key:
 * `inspectReadout.ts:148` turns that report field into a *sentence* —
 * *"this element is not drawn: display: none on it or on an ancestor"* — and the
 * control reply carries it in `notes`. Measured on the live fixture: a
 * `display: none` button refused with `0x0` and named no rule, because the field
 * I was reading did not exist. Carrying the note instead means the refusal says
 * exactly what the product already knows how to say, in one voice, and gains a
 * `visibility: hidden` case nobody has to re-derive here.
 */
export function zeroSizeRefusal(selector: string, rect: Box, notes: string[] = []): string {
  const drawn = notes.filter(n => n.includes('not drawn'))
  const why = drawn.length > 0 ? ` — ${drawn.join(' ')}` : ''
  return (
    `${JSON.stringify(selector)} matches an element with no area ` +
    `(${rect.width}x${rect.height} at ${rect.x},${rect.y})${why}: a click needs a point inside it`
  )
}

export function notBroughtIntoViewRefusal(selector: string, rect: Box, viewport: Viewport, scrolledTo: { x: number; y: number }): string {
  return (
    `${JSON.stringify(selector)} is still outside the ${viewport.width}x${viewport.height} viewport after scrolling to ` +
    `${scrolledTo.x},${scrolledTo.y}: its box reads ${rect.width}x${rect.height} at ${rect.x},${rect.y}. ` +
    `A page whose scroll is owned by an inner element, or a fixed element placed off-screen, does this`
  )
}

/**
 * No point inside the box resolves to the element itself.
 *
 * **A refusal rather than a warning, deliberately.** The failing case reported `ran` with nothing to
 * distinguish it from a press that landed, and a flow then described a journey it never made. A
 * warning would reach the report and not the caller's reply, which `docs/release-gate.md` names as no
 * disclosure at all. So the step fails, and the sentence says what was tried.
 */
export function noPointHitsRefusal(selector: string, rect: Box, tried: number, saw: string[]): string {
  const what = saw.length > 0 ? ` — the ${tried} points tried resolved to ${[...new Set(saw)].join(', ')} instead` : ''
  return (
    `${JSON.stringify(selector)} has a box (${rect.width}x${rect.height} at ${rect.x},${rect.y}) but no point inside it ` +
    `resolves to that element${what}. An inline element whose text wraps does this: its box spans every line ` +
    `plus the gap between them, and the gap belongs to the block around it`
  )
}

/** The hit check could not run, so no point is verified.
 *
 *  Named separately from "no point hits" because they are different facts: one says the element cannot
 *  be pressed, the other says we could not tell. The first version of the check collapsed them by
 *  swallowing the failure and pressing the box centre — the exact point the defect is about. */
export function probeUnavailableRefusal(selector: string, why: string): string {
  return (
    `${JSON.stringify(selector)} was located, but Obsrv could not check what is drawn at the point it chose ` +
    `(${why}), so the press was not attempted: an unverified point is how a click lands on the page behind ` +
    `the element and still reports success`
  )
}
