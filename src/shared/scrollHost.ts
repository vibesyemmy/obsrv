/**
 * Finding the element a page actually scrolls.
 *
 * Two callers need this and must not disagree. The sync preload applies an
 * agent's `scroll` to it, and the headless full-page capture scrolls it to
 * take its bands — an app shell (`html, body { overflow: hidden }` with an
 * inner `overflow-y: auto` container) reports a document exactly as tall as
 * the viewport, so a capture that scrolls the window gets the first screen
 * and nothing else. One implementation, used from both: the preload imports
 * these directly, and the capture injects `SCROLL_HOST_SCRIPT`, which is
 * these same functions serialised.
 *
 * Everything here runs in the page, so it may use only page globals.
 */

/**
 * Elements the scroll-host walk may visit. A pathological DOM (a virtualised
 * table, a design tool's canvas of nodes) must not stall the preload — and
 * therefore the whole scroll round-trip — walking a million elements. Beyond
 * this the best candidate found so far wins; the root is the fallback.
 */
export const MAX_VISITED = 2000

/** Slack for sub-pixel layout: a one-pixel overflow is not a scroller. */
const SCROLL_EPSILON = 1

/** Whether the document root itself has anything to scroll. */
export function rootScrolls(): boolean {
  const el = document.scrollingElement
  if (!el) return false
  return el.scrollHeight > el.clientHeight + SCROLL_EPSILON || el.scrollWidth > el.clientWidth + SCROLL_EPSILON
}

/**
 * Whether this element is a scroll container with something to scroll. The
 * cheap overflow test comes first so `getComputedStyle` — the expensive half —
 * runs only for the handful of elements that could possibly qualify.
 */
export function canScroll(el: Element): boolean {
  const overflowsY = el.scrollHeight > el.clientHeight + SCROLL_EPSILON
  const overflowsX = el.scrollWidth > el.clientWidth + SCROLL_EPSILON
  if (!overflowsY && !overflowsX) return false
  const style = window.getComputedStyle(el)
  const scrollableY = style.overflowY === 'auto' || style.overflowY === 'scroll'
  const scrollableX = style.overflowX === 'auto' || style.overflowX === 'scroll'
  return (overflowsY && scrollableY) || (overflowsX && scrollableX)
}

/**
 * Whether an element is visible enough to be the page's scroll host.
 * `checkVisibility` is the only cheap way to see through `visibility: hidden`,
 * `opacity: 0` and `content-visibility: hidden` — all of which keep full
 * client area, so a closed drawer would otherwise win "largest scroller".
 * Guarded: the preload runs beside whatever page the user navigates to, and on
 * an engine without the method a missing check must not veto every candidate.
 *
 * An element translated off-canvas (`transform: translateX(-100%)`) is still
 * "visible" to this test and remains eligible. Transforms are how a great many
 * *open* panels are positioned too, so excluding them would cost more than it
 * saves; `scrollSelector` is the escape hatch if a page ever hits it.
 */
export function isVisible(el: Element): boolean {
  const check = (el as Element & { checkVisibility?: (options?: unknown) => boolean }).checkVisibility
  if (typeof check !== 'function') return el.getClientRects().length > 0
  return check.call(el, { visibilityProperty: true, opacityProperty: true })
}

/**
 * The page's real scroll host: the largest-by-client-area visible descendant
 * that is a scroll container with something to scroll. Depth-first, so an
 * exact tie between an ancestor-side and a later candidate keeps the one found
 * first. The walk is bounded by `MAX_VISITED`.
 *
 * Only `display: none` subtrees are pruned, and only after a computed-style
 * check. Client area cannot stand in for "has no box": an inline wrapper
 * (`<span>`, `<a>`) and a `display: contents` wrapper both report
 * `clientWidth === clientHeight === 0`, and pruning on that hid every scroller
 * beneath them. `checkVisibility` cannot stand in either — it answers false
 * for `display: contents` exactly as it does for `display: none`. So the
 * boxless case resolves the ambiguity with `getComputedStyle`, which runs for
 * the handful of boxless elements only, never for the whole tree. Elements
 * inside a `display: none` subtree could never win anyway (their geometry is
 * all zeroes); the prune is there so a hidden mega-list cannot eat the budget
 * and starve the real scroller.
 *
 * Reach limits: the walk sees light DOM in this document only. A scroller
 * inside a shadow root or an iframe is unreachable — and so is
 * `scrollSelector`, since `document.querySelector` does not cross either
 * boundary — which leaves a web-component app with no escape hatch.
 *
 * Returns null when nothing qualifies, which the caller reads as "use the
 * root". Exported: the deliberate follow-up that mirrors a *user's*
 * inner-scroller scrolling needs exactly this function.
 */
export function findScroller(root: Element | null = document.body): Element | null {
  if (!root) return null
  let best: Element | null = null
  let bestArea = 0
  let visited = 0
  const stack: Element[] = [root]
  while (stack.length > 0) {
    const el = stack.pop()!
    if (visited++ >= MAX_VISITED) break
    const area = el.clientWidth * el.clientHeight
    if (area <= 0 && el.getClientRects().length === 0 && window.getComputedStyle(el).display === 'none') continue
    // `isVisible` runs last: it is the expensive half, and only an element
    // that would otherwise win needs to answer for its visibility.
    if (area > bestArea && canScroll(el) && isVisible(el)) {
      best = el
      bestArea = area
    }
    // Pushed in reverse so `pop` yields document order — the depth-first
    // traversal the tiebreak is defined against.
    const kids = el.children
    for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]!)
  }
  return best
}


/**
 * Whether a scroll container the capture never drives is holding this element
 * out of view.
 *
 * A walk records every box in page coordinates (`rect.top + scrollY`), which
 * is a position on the captured page only for elements the page's own scroll
 * reaches. An element inside *another* scroller — a docs sidebar `sticky` at
 * 663 px tall over its own 7,708 px of links, measured on tailwindcss.com/docs
 * — keeps growing that offset for every item past the sidebar's fold, so its
 * page coordinates run far below a document that is 2,591 px tall. Those
 * findings are real; their coordinates are not a place on the page, and a
 * report that pins by them puts them off the bottom of a capture that covers
 * the page whole.
 *
 * `host` is the element the capture scrolls — the shell scroller, or null when
 * the document itself scrolls. Whatever that one holds *is* reachable, so it
 * is skipped; everything else clips. Only `overflow: auto | scroll` counts
 * (`canScroll`), the same test the capture picks its host with: an
 * `overflow: hidden` wrapper clips too, but that is a different claim and
 * wants its own evidence.
 *
 * Returns a predicate rather than a function of both, because a walk asks it
 * about hundreds of siblings that share ancestors, and the ancestor's own
 * `canScroll` (a `getComputedStyle` call) is the expensive half. Cached per
 * element, the cost is one style read per container on the page.
 */
export function clipTest(host: Element | null): (r: DOMRect, el: Element) => boolean {
  const boxes = new Map<Element, DOMRect | null>()
  const clipperBox = (el: Element): DOMRect | null => {
    const seen = boxes.get(el)
    if (seen !== undefined) return seen
    const box = el !== host && canScroll(el) ? el.getBoundingClientRect() : null
    boxes.set(el, box)
    return box
  }
  return (r: DOMRect, el: Element): boolean => {
    for (let a = el.parentElement; a; a = a.parentElement) {
      const box = clipperBox(a)
      if (!box) continue
      // Fully outside the container's box on either axis: not a pixel of it is
      // drawn where the page's own scroll could show it. Partly out is left
      // alone — the top of a half-scrolled row is on screen, and its rect is
      // where the capture will find it.
      if (
        r.bottom <= box.top + SCROLL_EPSILON ||
        r.top >= box.bottom - SCROLL_EPSILON ||
        r.right <= box.left + SCROLL_EPSILON ||
        r.left >= box.right - SCROLL_EPSILON
      ) {
        return true
      }
    }
    return false
  }
}

/**
 * Page coordinates for an element: its viewport rect plus what the page's
 * own scroller has scrolled away. `host` is the element the capture scrolls
 * (the shell's scroller), or null when the document itself scrolls. On an
 * app shell the window never moves — `window.scrollY` is 0 however far the
 * host's content has gone — so an element the host holds adds the host's
 * offset; anything outside it (the shell's fixed chrome) moves with the
 * window alone. Measured on usekolo.app scrolled to the bottom before this
 * existed: every element above the fold had a negative top, was dropped as
 * parked off the page, and pageHeight collapsed to the viewport.
 */
export function scrollOffset(host: Element | null): (el: Element) => { x: number; y: number } {
  return (el: Element) =>
    host !== null && host !== el && host.contains(el)
      ? { x: window.scrollX + host.scrollLeft, y: window.scrollY + host.scrollTop }
      : { x: window.scrollX, y: window.scrollY }
}

/**
 * The functions above, serialised for `executeJavaScript` in a page the
 * preload is not loaded into — the headless render. Composed from their own
 * source rather than written twice, so the capture and the live scroll can
 * never drift apart. Evaluating it leaves `findScrollHost` and `scrollOffset`
 * on the page.
 */
export const SCROLL_HOST_SCRIPT = [
  `const MAX_VISITED = ${MAX_VISITED}`,
  `const SCROLL_EPSILON = ${SCROLL_EPSILON}`,
  rootScrolls.toString(),
  canScroll.toString(),
  isVisible.toString(),
  findScroller.toString(),
  clipTest.toString(),
  scrollOffset.toString(),
].join('\n')
