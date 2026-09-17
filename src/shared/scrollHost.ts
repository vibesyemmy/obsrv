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

/**
 * The element a node is drawn inside: its slot when it is slotted, its parent
 * element, or — at the top of a shadow tree — the root's host. That is the
 * flat tree the page is painted from, and `parentElement` stops short of it at
 * every shadow boundary: text inside a component climbed to the root and
 * composited onto the page's white instead of the component's own dark card.
 *
 * Open roots only, by construction: a closed root's host hides it from
 * script (`assignedSlot` is null, and nothing reaches in), so what the page
 * closed stays outside every measurement, as it was.
 */
export function shadowParent(el: Element): Element | null {
  if (el.assignedSlot) return el.assignedSlot
  if (el.parentElement) return el.parentElement
  const up = el.parentNode
  return up instanceof ShadowRoot ? up.host : null
}

/** Whether `inner` is drawn inside `outer`, across shadow boundaries (`shadowParent`). */
export function shadowContains(outer: Element, inner: Element): boolean {
  for (let node: Element | null = inner; node !== null; node = shadowParent(node)) {
    if (node === outer) return true
  }
  return false
}

/**
 * Every element under `root`, open shadow roots included: an element, then its
 * shadow tree, then its own children. That is close to the order they are
 * drawn in but not the flat tree exactly — a slotted child is visited where it
 * sits in the light DOM, not at the slot that shows it.
 *
 * `querySelectorAll` and a TreeWalker both stop at a shadow boundary, so a
 * page built from web components measured as nothing (chromestatus.com,
 * 2026-09-12: 159 roots, 136 interactive elements, 0 measured). A slotted
 * child is a child of its host, not of the slot, so it is visited once, where
 * it sits in the light DOM; the slot that shows it has no children of its own.
 */
export function shadowElements(root: Element | null): Element[] {
  const out: Element[] = []
  if (!root) return out
  const stack: Element[] = [root]
  while (stack.length > 0) {
    const el = stack.pop()!
    out.push(el)
    // Pushed in reverse, children first, so `pop` yields the shadow tree
    // before the light children and each in document order.
    const kids = el.children
    for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]!)
    const shadow = el.shadowRoot
    if (shadow) {
      const inner = shadow.children
      for (let i = inner.length - 1; i >= 0; i--) stack.push(inner[i]!)
    }
  }
  return out
}

/**
 * The element at a viewport point, through open shadow roots:
 * `document.elementFromPoint` answers with the host, and the host's own root
 * answers with what is drawn there.
 */
export function shadowElementFromPoint(x: number, y: number): Element | null {
  let el = document.elementFromPoint(x, y)
  while (el !== null && el.shadowRoot) {
    const inner = el.shadowRoot.elementFromPoint(x, y)
    if (inner === null || inner === el) break
    el = inner
  }
  return el
}

/**
 * What is painted at a point, top to bottom, from `el` down — across shadow
 * boundaries.
 *
 * `elementsFromPoint` answers in ONE tree scope: everything inside a shadow
 * root is retargeted to its host, and everything slotted into a root stays in
 * the scope it was written in. So neither the document's answer nor a single
 * root's is the whole stack:
 * - for an element inside a root, the document's answer names the host;
 * - for an element SLOTTED into a root, the root's own background is drawn
 *   between the text and the page, and the document's answer skips it. That is
 *   the ordinary card: the component paints the surface inside its root and
 *   the page writes the text (Wren's measurement on #293 — text slotted into a
 *   dark card was judged on the page's white at 1.24:1, where what is painted
 *   is 11.86:1).
 *
 * So every scope the element is composed through is asked — its own, and each
 * one a slot or a host takes it into — and the answers are merged into a
 * single order. They are consistent: each is a subsequence of what is really
 * painted, so an element is taken only once nothing else still has it deeper.
 * Null when `el` is not painted at the point in any of them.
 */
export function shadowStackFrom(el: Element, x: number, y: number): Element[] | null {
  // The chain the element is drawn through: slots and hosts included.
  const chain: Element[] = []
  for (let node: Element | null = el; node !== null; node = shadowParent(node)) chain.push(node)
  const stacks: Element[][] = []
  const asked = new Set<Node>()
  let found = false
  for (let i = 0; i < chain.length; i++) {
    const scope: Node = chain[i]!.getRootNode()
    if (asked.has(scope)) continue
    asked.add(scope)
    const stack = (scope instanceof ShadowRoot ? scope : document).elementsFromPoint(x, y)
    if (stack.indexOf(el) === 0) found = true
    // Where this scope's answer joins the chain: the element itself, or the
    // first thing above it that this scope can see (a slot has no box of its
    // own, and `display: contents` elements are absent too).
    let at = -1
    for (let j = i; j < chain.length && at < 0; j++) at = stack.indexOf(chain[j]!)
    if (at >= 0) stacks.push(stack.slice(at))
  }
  if (!found) return null
  // One order out of several: take the head no other answer still has deeper,
  // which keeps every scope's relative order and cannot repeat an element.
  const out: Element[] = []
  for (;;) {
    let pick = -1
    for (let i = 0; i < stacks.length && pick < 0; i++) {
      const head = stacks[i]![0]
      if (head === undefined) continue
      if (!stacks.some((s, j) => j !== i && s.indexOf(head) > 0)) pick = i
    }
    if (pick < 0) pick = stacks.findIndex(s => s.length > 0)
    if (pick < 0) break
    const head = stacks[pick]![0]!
    out.push(head)
    for (const s of stacks) {
      const k = s.indexOf(head)
      if (k >= 0) s.splice(k, 1)
    }
  }
  return out.length > 0 ? out : null
}

/** Whether the document root itself has anything to scroll. */
export function rootScrolls(): boolean {
  const el = document.scrollingElement
  if (!el) return false
  return el.scrollHeight > el.clientHeight + SCROLL_EPSILON || el.scrollWidth > el.clientWidth + SCROLL_EPSILON
}

/**
 * Whether the page has hidden the document's overflow — `html` or `body`
 * with `overflow-y: hidden` — which is a page saying it manages its own
 * scrolling. With no scroller anywhere else either (open shadow roots
 * included), whatever it shows past one screen is somewhere neither a capture
 * nor a walk can reach; both say so.
 */
/**
 * Whether an element sits inside a dialog — a `<dialog>`, or the ARIA
 * spelling every modal library reaches for. Used by the walk: a page that
 * locks its own scroll while a dialog is open leaves the dialog's panel as
 * the only scroller left on the page, and a walk that scrolls *that* has not
 * walked the page at all. Named semantics rather than a guess at sizes, so a
 * page locked by an anonymous div says nothing instead of the wrong thing.
 */
export function inDialog(el: Element | null): boolean {
  // Across shadow boundaries (`shadowParent`): `closest` stops at a root, so a
  // dialog whose panel is a component — or a component's scroller inside a
  // page's dialog — read as a panel on the page (Wren's read of #293).
  const SELECTOR = 'dialog, [role="dialog"], [role="alertdialog"], [aria-modal="true"]'
  for (let node: Element | null = el; node !== null; node = shadowParent(node)) {
    if (node.matches(SELECTOR)) return true
  }
  return false
}

export function overflowHidden(): boolean {
  const doc = window.getComputedStyle(document.documentElement).overflowY === 'hidden'
  const body = !!document.body && window.getComputedStyle(document.body).overflowY === 'hidden'
  return doc || body
}

/**
 * The iframes in the viewport at the page's top, and how much of it they
 * cover (clipped areas summed, capped at the whole viewport). For the
 * sentence a measurement with nothing in it carries: the measurement does not
 * enter iframes, and a bot wall — etsy.com behind DataDome, measured
 * 2026-09-11 — is one iframe over the whole viewport, a heading and a slider
 * inside it, and "nothing to measure" outside.
 */
export function framesInViewport(): { count: number; viewportCoverage: number } {
  const vw = window.innerWidth
  const vh = window.innerHeight
  let count = 0
  let area = 0
  for (const frame of Array.from(document.querySelectorAll('iframe'))) {
    const r = frame.getBoundingClientRect()
    const w = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0))
    const h = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0))
    if (w > 0 && h > 0) {
      count++
      area += w * h
    }
  }
  return { count, viewportCoverage: vw > 0 && vh > 0 ? Math.min(1, area / (vw * vh)) : 0 }
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
 * that is a scroll container with something to scroll. Level order, so an
 * exact tie between an ancestor-side and a later candidate keeps the one found
 * first. The walk is bounded by `MAX_VISITED`, which open shadow roots share:
 * what the budget cuts off is not reported, which is
 * `chore-scroll-host-budget-is-silent`.
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
 * Reach: this document, open shadow roots included (a feed inside a
 * component is a page's scroller as much as one in the light DOM). A scroller
 * inside an iframe or a closed root is unreachable, and so is `scrollSelector`
 * for anything inside a root, since `document.querySelector` does not cross
 * the boundary.
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
  // BREADTH-FIRST, and the budget is why. Depth-first spent the whole budget
  // inside one sibling's subtree, and with open roots in it that is a handful
  // of components: a sidebar of 286 items, each a host with six elements in
  // its root, starved the search before it reached `main`, and the page's real
  // scroller lost to the sidebar — or, when the sidebar did not overflow, to
  // nothing at all (Wren's measurement on #293). A scroll host is a large,
  // shallow box, so level order reaches every candidate that could win long
  // before a deep tree can exhaust the budget.
  const queue: Element[] = [root]
  for (let head = 0; head < queue.length; head++) {
    const el = queue[head]!
    if (visited++ >= MAX_VISITED) break
    const area = el.clientWidth * el.clientHeight
    if (area <= 0 && el.getClientRects().length === 0 && window.getComputedStyle(el).display === 'none') continue
    // `isVisible` runs last: it is the expensive half, and only an element
    // that would otherwise win needs to answer for its visibility.
    if (area > bestArea && canScroll(el) && isVisible(el)) {
      best = el
      bestArea = area
    }
    // An open shadow tree before the light children, as `shadowElements`
    // orders them. Level order keeps the tiebreak the comment above states:
    // an ancestor-side candidate is reached before anything below it, so an
    // exact tie keeps the one found first.
    const shadow = el.shadowRoot
    if (shadow) for (const kid of Array.from(shadow.children)) queue.push(kid)
    for (const kid of Array.from(el.children)) queue.push(kid)
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
    // Across shadow boundaries: a list inside a component's own scroller is
    // held out of view by it exactly as a light-DOM sidebar is.
    for (let a = shadowParent(el); a; a = shadowParent(a)) {
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
  // `shadowContains`, not `contains`: a host scroller inside a component holds
  // the light-DOM items slotted into it, which `contains` says it does not.
  return (el: Element) =>
    host !== null && host !== el && shadowContains(host, el)
      ? { x: window.scrollX + host.scrollLeft, y: window.scrollY + host.scrollTop }
      : { x: window.scrollX, y: window.scrollY }
}

/**
 * The shadow-tree helpers alone, serialised: what a page-side function that
 * crosses shadow boundaries needs beside it (`INSPECT_SCRIPT`), and the first
 * half of `SCROLL_HOST_SCRIPT`.
 */
export const SHADOW_TREE_SCRIPT = [
  shadowParent.toString(),
  shadowContains.toString(),
  shadowElements.toString(),
  shadowElementFromPoint.toString(),
  shadowStackFrom.toString(),
].join('\n')

/**
 * The functions above, serialised for `executeJavaScript` in a page the
 * preload is not loaded into — the headless render. Composed from their own
 * source rather than written twice, so the capture and the live scroll can
 * never drift apart. Evaluating it leaves `findScroller` and `scrollOffset`
 * on the page.
 */
export const SCROLL_HOST_SCRIPT = [
  `const MAX_VISITED = ${MAX_VISITED}`,
  `const SCROLL_EPSILON = ${SCROLL_EPSILON}`,
  SHADOW_TREE_SCRIPT,
  rootScrolls.toString(),
  overflowHidden.toString(),
  inDialog.toString(),
  framesInViewport.toString(),
  canScroll.toString(),
  isVisible.toString(),
  findScroller.toString(),
  clipTest.toString(),
  scrollOffset.toString(),
].join('\n')

export interface WalkStepResult {
  /** The offset actually reached, in the scroller's own CSS px. */
  y: number
  /** No more page below this offset. */
  atEnd: boolean
  scroller: 'root' | 'element'
  /**
   * The document hides its overflow (`overflowHidden`). With `scroller:
   * 'root'` and nothing to scroll, the walk had nowhere to go, and says so.
   */
  hidden: boolean
  /**
   * The container that was scrolled sits inside a dialog (`inDialog`). With
   * `hidden`, the page itself is locked and the screenfuls above are the
   * dialog's, not the page's — which the walk says rather than letting
   * `atEnd` vouch for a page it never crossed.
   */
  dialog: boolean
  /**
   * What was on the page when the walk found nothing to scroll: the iframes
   * over the viewport, so the note can name the cause it measured instead of
   * guessing (`walkNothingNote`). Measured only in that case, since it walks
   * the whole document and a walk that is moving has no use for it.
   */
  blocked?: { frames: { count: number; viewportCoverage: number } }
  /**
   * The document's height when this step was taken. Compared between the
   * walk's first step and its last, it says whether a page taller than the
   * walk covered GREW under it or was HELD — which `walkCoverageNote` used to
   * guess from `documentLocked`, and got wrong on one page shape per surface
   * (app-shell-grows headless, dialog-over-tall live). Absent from an older
   * app's reply, and the sentence then keeps its hedge rather than stating
   * something nobody measured.
   */
  pageHeight?: number
}

/**
 * One move of the headless walk (`src/cli/walk.ts`): a screenful of whatever
 * the page scrolls — the root, or the inner container of an app shell — with
 * the arithmetic the live `scroll { page }` uses (src/preload/sync.ts):
 * `next` is the scroller's own client height, clamped to what is left, and
 * `atEnd` is an offset that can go no further. Called as
 * `WALK_STEP_SCRIPT('next')` until it says so, then `'top'`.
 *
 * Lives in this module, not its own: the bundler keeps a function beside the
 * helpers it calls under their bare names, which is what its serialised form
 * needs. In a module of its own it landed in cli.js and called
 * `capture.rootScrolls()` — a namespace no page has (measured: every walk
 * "cut short before it began").
 */
export function walkStep(page: 'top' | 'next'): WalkStepResult {
  const el = rootScrolls() ? null : findScroller()
  const view = el ? el.clientHeight : window.innerHeight
  const height = el ? el.scrollHeight : document.documentElement.scrollHeight
  const max = Math.max(0, height - view)
  const cur = el ? el.scrollTop : window.scrollY
  const want = page === 'top' ? 0 : Math.min(cur + view, max)
  // `instant` defeats a page's `scroll-behavior: smooth`, which would animate
  // the move and leave the read-back short of it.
  if (el) el.scrollTo({ top: want, left: el.scrollLeft, behavior: 'instant' })
  else window.scrollTo({ top: want, left: window.scrollX, behavior: 'instant' })
  const y = el ? el.scrollTop : window.scrollY
  const atEnd = y >= max - 1
  const hidden = overflowHidden()
  // The one case the note has to explain: the root is the scroller, it hides
  // its overflow, and there is nowhere to go. Everything else pays nothing.
  const stuck = atEnd && el === null && hidden
  return {
    y,
    atEnd,
    scroller: el ? 'element' : 'root',
    hidden,
    dialog: inDialog(el),
    // The document's own height, on every step rather than once. It is the
    // only way to answer the question `walkCoverageNote` was guessing at:
    // a page taller than the walk covered either GREW while being walked or
    // was HELD, and nothing measured which. Read from the document rather
    // than the scroller, because a panel's height is not the page's.
    pageHeight: Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0),
    ...(stuck ? { blocked: { frames: framesInViewport() } } : {}),
  }
}

/** `walkStep` as source, self-contained, for `executeJavaScript` in a page the preload is not loaded into. */
export const WALK_STEP_SCRIPT = `(() => {\n${SCROLL_HOST_SCRIPT}\n return (${walkStep.toString()})\n})()`
