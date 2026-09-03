import { ipcRenderer } from 'electron'
import type { IPC } from '../shared/ipc'
import type { MenuGroup } from '../shared/api'
import type { MAX_SELECT_OPTIONS, SelectOpen, SelectPick } from '../shared/selectPopup'
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
export const MAX_VISITED = 2000

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
function isVisible(el: Element): boolean {
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
 * The scroll host to apply an offset to, or null for the root. Cached per
 * document because the walk is the expensive part of a round-trip.
 *
 * The cache is revalidated on every use, but only against the element it
 * holds: it is dropped when that element detaches, stops being able to scroll,
 * or when the root becomes scrollable again. It does *not* re-run the walk to
 * see whether a *better* candidate has appeared, so an SPA that mounts a
 * larger scroller beside the cached one keeps scrolling the cached one until
 * that one goes away. Re-running the search per scroll would pay the walk on
 * every command for a case no page has hit yet; `scrollSelector` names the
 * container outright when it does.
 */
let cachedScroller: Element | null = null

export function resolveScroller(): Element | null {
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

// --- <select> popups ---------------------------------------------------------
// The offscreen target cannot show a select's popup: Chromium draws it
// outside the page's compositor (a native menu on macOS), and an offscreen
// window has nothing to hang it on — the select reports itself open, swallows
// the keyboard and shows nothing. So, in the target only, the press is caught
// before Chromium acts on it and the options are sent to main, which has the
// chrome draw them over the canvas; the pick comes back here and is written
// into the element with the events a real pick fires. Native `<select
// multiple>` and sized listboxes render in-page and are left alone. See
// shared/selectPopup.ts for the round trip and the reason for the indexes.

const SELECT_OPEN = 'obsrv:select-open' satisfies typeof IPC.selectOpen
const SELECT_PICK = 'obsrv:select-pick' satisfies typeof IPC.selectPick
const SELECT_ROWS = 1000 satisfies typeof MAX_SELECT_OPTIONS
/** Label length main accepts (`MAX_MENU_LABEL`); longer is cut, not refused. */
const LABEL_MAX = 120
/**
 * Only the offscreen target names itself (see `TargetSource.createWindow`).
 * Guarded for the browser test that imports this module for `findScroller`,
 * where there is no `process` at all.
 */
const IS_TARGET = typeof process !== 'undefined' && Array.isArray(process.argv) && process.argv.includes('--obsrv-target')

let nextSelectId = 1
const pendingSelects = new Map<number, HTMLSelectElement>()

/** A select whose popup Chromium would draw as a widget: single, not a listbox, enabled. */
function popupSelect(el: unknown): el is HTMLSelectElement {
  return el instanceof HTMLSelectElement && !el.multiple && el.size <= 1 && !el.disabled
}

const cut = (s: string): string => (s.length > LABEL_MAX ? s.slice(0, LABEL_MAX) : s)

/** The select's rows as menu groups, one per optgroup; disabled rows are left out. */
function menuGroupsOf(sel: HTMLSelectElement): MenuGroup[] {
  const groups: MenuGroup[] = []
  let current: MenuGroup | null = null
  let currentParent: Element | null = null
  let rows = 0
  for (let i = 0; i < sel.options.length && rows < SELECT_ROWS; i++) {
    const opt = sel.options[i]!
    const parent = opt.parentElement
    const group = parent instanceof HTMLOptGroupElement ? parent : null
    if (group?.disabled || opt.disabled) continue
    if (current === null || currentParent !== parent) {
      current = group ? { label: cut(group.label), options: [] } : { options: [] }
      currentParent = parent
      groups.push(current)
    }
    current.options.push({ value: String(i), label: cut(opt.label || opt.text) })
    rows++
  }
  return groups.filter(g => g.options.length > 0)
}

function accessibleName(sel: HTMLSelectElement): string {
  const explicit = sel.getAttribute('aria-label')
  if (explicit) return cut(explicit)
  const label = sel.labels?.[0]?.textContent?.trim()
  return label ? cut(label) : 'Select'
}

function openSelect(sel: HTMLSelectElement): void {
  const groups = menuGroupsOf(sel)
  if (groups.length === 0) return
  const id = nextSelectId++
  pendingSelects.set(id, sel)
  const r = sel.getBoundingClientRect()
  ipcRenderer.send(SELECT_OPEN, {
    id,
    rect: { x: r.left, y: r.top, width: r.width, height: r.height },
    selectedIndex: sel.selectedIndex,
    ariaLabel: accessibleName(sel),
    groups,
  } satisfies SelectOpen)
}

if (IS_TARGET) {
  // Capture phase, so the page's own handlers still run after — only the
  // default action (Chromium's popup, and with it the focus) is taken over.
  document.addEventListener(
    'mousedown',
    e => {
      const el = e.target
      if (e.button !== 0 || !popupSelect(el)) return
      e.preventDefault()
      el.focus()
      openSelect(el)
    },
    true,
  )
  // The keys that open a closed select; typing a letter still changes the
  // value in place, as it does in a real browser, and needs no popup.
  document.addEventListener(
    'keydown',
    e => {
      const el = document.activeElement
      if (!popupSelect(el)) return
      if (e.key !== ' ' && e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
      e.preventDefault()
      openSelect(el)
    },
    true,
  )
  ipcRenderer.on(SELECT_PICK, (_e, pick: SelectPick) => {
    const sel = pendingSelects.get(pick.id)
    pendingSelects.delete(pick.id)
    if (!sel || !sel.isConnected || pick.index === null) return
    const opt = sel.options[pick.index]
    if (!opt || opt.disabled || pick.index === sel.selectedIndex) return
    sel.selectedIndex = pick.index
    sel.dispatchEvent(new Event('input', { bubbles: true }))
    sel.dispatchEvent(new Event('change', { bubbles: true }))
  })
}
