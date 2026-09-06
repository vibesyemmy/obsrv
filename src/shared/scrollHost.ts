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
 * The functions above, serialised for `executeJavaScript` in a page the
 * preload is not loaded into — the headless render. Composed from their own
 * source rather than written twice, so the capture and the live scroll can
 * never drift apart. Evaluating it leaves `findScrollHost` on the page.
 */
export const SCROLL_HOST_SCRIPT = [
  `const MAX_VISITED = ${MAX_VISITED}`,
  `const SCROLL_EPSILON = ${SCROLL_EPSILON}`,
  rootScrolls.toString(),
  canScroll.toString(),
  isVisible.toString(),
  findScroller.toString(),
].join('\n')
