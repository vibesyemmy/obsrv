import { ipcRenderer } from 'electron'
import type { IPC } from '../shared/ipc'
import type { ScrollPos, ScrollReport, ScrollRequest, ScrollerKind } from '../shared/types'

/**
 * Injected into both page webContents — the native pane and the offscreen
 * target — so their scroll offsets track each other. Nothing is exposed to
 * the page: the listener lives in the isolated world and only `ipcRenderer`
 * is touched, so a third-party page cannot reach this channel.
 *
 * Applying handles the app-shell pattern (`html, body { overflow: hidden }`
 * with an inner `overflow-y: auto` scroller — dashboards, editors, most app
 * landings): `findScroller` picks the inner scroll host when the root has
 * nothing to scroll, and the offset is written to *that* element. Absolute
 * offsets and two-pane synchronisation survive, because both panes run the
 * same detection over the same DOM.
 *
 * *Reporting* is still window-only: a user dragging an inner scroller in the
 * native pane is not mirrored to the target (Element scroll events do not
 * bubble to `window`, so nothing here even sees it). Mirroring that is a
 * deliberate follow-up; `findScroller` is written to be reusable by it.
 *
 * This file must not share a runtime module with `app.ts`: the two preloads
 * are entries of one Rollup build, and anything they both import is split into
 * `out/preload/chunks/`, which a sandboxed preload's `require` cannot load
 * (it resolves only `electron` and a few builtins). The channel names are
 * therefore literals here, pinned to `IPC` by `satisfies` so a rename fails
 * `typecheck` instead of silently cutting the bus.
 *
 * Echo control is a short time window rather than a boolean flag: a
 * programmatic `scrollTo` that lands where the page already is fires no scroll
 * event at all, which would leave a flag stuck and swallow the next real
 * scroll. A window always expires. Inside it, reports are deferred to its end
 * rather than dropped, so a real scroll that happens just after an applied
 * one is delayed, never lost. Behind the window the last applied position is
 * remembered too: a scroll event that arrives late but reports exactly what
 * the other pane sent is still an echo, not news. That memory is dropped as
 * soon as a different position is reported, so scrolling away and back to
 * that spot is reported like any other move.
 */
const SUPPRESS_MS = 120

const SYNC_SCROLL = 'obsrv:sync-scroll' satisfies typeof IPC.syncScroll
const APPLY_SCROLL = 'obsrv:apply-scroll' satisfies typeof IPC.applyScroll
const SCROLL_RESULT = 'obsrv:scroll-result' satisfies typeof IPC.scrollResult

/**
 * Elements the scroll-host walk may visit. A pathological DOM (a virtualised
 * table, a design tool's canvas of nodes) must not stall the preload — and
 * therefore the whole scroll round-trip — walking a million elements. Beyond
 * this the best candidate found so far wins; the root is the fallback.
 */
const MAX_VISITED = 2000

/** Slack for sub-pixel layout: a one-pixel overflow is not a scroller. */
const SCROLL_EPSILON = 1

let suppressUntil = 0
let lastApplied: ScrollPos | null = null
let rafId = 0
let deferred: ReturnType<typeof setTimeout> | null = null

function report(): void {
  rafId = 0
  const remaining = suppressUntil - performance.now()
  if (remaining > 0) {
    if (deferred === null) {
      deferred = setTimeout(() => {
        deferred = null
        report()
      }, remaining)
    }
    return
  }
  const x = window.scrollX
  const y = window.scrollY
  if (lastApplied && lastApplied.x === x && lastApplied.y === y) return
  lastApplied = null
  ipcRenderer.send(SYNC_SCROLL, { x, y })
}

window.addEventListener(
  'scroll',
  () => {
    // Coalesce a burst of scroll events into one report per frame.
    if (rafId !== 0) return
    rafId = requestAnimationFrame(report)
  },
  { passive: true },
)

// --- scroll-host detection ---------------------------------------------------

/** Whether the document root itself has anything to scroll. */
function rootScrolls(): boolean {
  const el = document.scrollingElement
  if (!el) return false
  return el.scrollHeight > el.clientHeight + SCROLL_EPSILON || el.scrollWidth > el.clientWidth + SCROLL_EPSILON
}

/**
 * Whether this element is a scroll container with something to scroll. The
 * cheap overflow test comes first so `getComputedStyle` — the expensive half —
 * runs only for the handful of elements that could possibly qualify.
 */
function canScroll(el: Element): boolean {
  const overflowsY = el.scrollHeight > el.clientHeight + SCROLL_EPSILON
  const overflowsX = el.scrollWidth > el.clientWidth + SCROLL_EPSILON
  if (!overflowsY && !overflowsX) return false
  const style = window.getComputedStyle(el)
  const scrollableY = style.overflowY === 'auto' || style.overflowY === 'scroll'
  const scrollableX = style.overflowX === 'auto' || style.overflowX === 'scroll'
  return (overflowsY && scrollableY) || (overflowsX && scrollableX)
}

/**
 * The page's real scroll host: the largest-by-client-area visible descendant
 * that is a scroll container with something to scroll. Depth-first, so an
 * exact tie between an ancestor-side and a later candidate keeps the one found
 * first. Zero-area subtrees (`display: none`, collapsed panels, closed
 * drawers) are skipped whole — their descendants cannot be the visible
 * scroller either — and the walk is bounded by `MAX_VISITED`.
 *
 * Returns null when nothing qualifies, which the caller reads as "use the
 * root". Exported shape kept simple on purpose: the deliberate follow-up that
 * mirrors a *user's* inner-scroller scrolling needs exactly this function.
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
    // A zero-area box paints nothing and contains nothing painted; skipping
    // the subtree is what keeps a hidden mega-list off the walk's budget.
    if (area <= 0) continue
    if (area > bestArea && canScroll(el)) {
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
 * The scroll host to apply an offset to, or null for the root. Cached per
 * document because the walk is the expensive part of a round-trip; the cache
 * is validated (still attached, still scrollable) on every use and dropped the
 * moment the root can scroll again, so a navigation, a re-render or a layout
 * change never leaves it pointing at a stale element.
 */
let cachedScroller: Element | null = null

function resolveScroller(): Element | null {
  if (rootScrolls()) {
    cachedScroller = null
    return null
  }
  if (cachedScroller && cachedScroller.isConnected && canScroll(cachedScroller)) return cachedScroller
  cachedScroller = findScroller()
  return cachedScroller
}

/**
 * Writes an absolute offset and reads back what was actually reached.
 * `behavior: 'instant'` defeats a page's `scroll-behavior: smooth`, which
 * would otherwise animate the move and make the read-back report the offset
 * before it rather than after.
 */
function applyTo(el: Element | null, pos: ScrollPos): ScrollPos {
  if (el) {
    el.scrollTo({ left: pos.x, top: pos.y, behavior: 'instant' })
    return { x: el.scrollLeft, y: el.scrollTop }
  }
  window.scrollTo({ left: pos.x, top: pos.y, behavior: 'instant' })
  return { x: window.scrollX, y: window.scrollY }
}

ipcRenderer.on(APPLY_SCROLL, (_e, req: ScrollRequest) => {
  const pos = { x: req.x, y: req.y }
  const warnings: string[] = []
  let scroller: ScrollerKind = 'root'
  let reached: ScrollPos

  if (typeof req.selector === 'string') {
    // The escape hatch: scroll exactly what the caller named, and never
    // silently fall back — an agent that asked for a specific container must
    // learn that it was not there rather than get a plausible other scroll.
    let el: Element | null = null
    try {
      el = document.querySelector(req.selector)
    } catch {
      warnings.push(`scrollSelector ${JSON.stringify(req.selector)} is not a valid CSS selector; nothing was scrolled`)
    }
    if (el) {
      scroller = 'element'
      reached = applyTo(el, pos)
      if (reached.x !== pos.x || reached.y !== pos.y) {
        warnings.push(
          `scrollSelector ${JSON.stringify(req.selector)} matched an element that could not reach ` +
            `(${pos.x}, ${pos.y}); it stopped at (${reached.x}, ${reached.y})`,
        )
      }
    } else {
      if (warnings.length === 0) {
        warnings.push(`scrollSelector ${JSON.stringify(req.selector)} matched no element; nothing was scrolled`)
      }
      reached = { x: window.scrollX, y: window.scrollY }
    }
  } else {
    const el = resolveScroller()
    scroller = el ? 'element' : 'root'
    // Only a root apply can echo back through the window `scroll` listener, so
    // only a root apply arms the suppression window. An element scroll fires no
    // window scroll event at all (Element scroll events do not bubble), and
    // remembering its offset here would compare inner-scroller coordinates
    // against `window.scrollX`.
    if (!el) {
      lastApplied = pos
      if (window.scrollX !== pos.x || window.scrollY !== pos.y) suppressUntil = performance.now() + SUPPRESS_MS
    }
    reached = applyTo(el, pos)
  }

  if (typeof req.id === 'number') {
    ipcRenderer.send(SCROLL_RESULT, { id: req.id, x: reached.x, y: reached.y, scroller, warnings } satisfies ScrollReport)
  }
})
