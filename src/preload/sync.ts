import { ipcRenderer } from 'electron'
import type { IPC } from '../shared/ipc'
import type { MenuGroup } from '../shared/api'
import type { MAX_SELECT_OPTIONS, SelectOpen, SelectPick } from '../shared/selectPopup'
import type { MAX_PICKER_VALUE, PickerOpen, PickerPick, PickerType } from '../shared/pickerPopup'
import type { ScrollPos, ScrollReport, ScrollRequest, ScrollerKind } from '../shared/types'
// One implementation, shared with the headless capture; see shared/scrollHost.ts.
import { MAX_VISITED, canScroll, findScroller, rootScrolls } from '../shared/scrollHost'
// Re-exported: `MAX_VISITED` and `findScroller` are this module's public face
// for tests/browser/findScroller.test.ts, which predates the move.
export { MAX_VISITED, findScroller }

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
  /** The screenful for a page-wise request, against whichever scroller will take it. */
  const pageTarget = (el: Element | null): ScrollPos => {
    const cur = el ? { x: el.scrollLeft, y: el.scrollTop } : { x: window.scrollX, y: window.scrollY }
    const view = el ? el.clientHeight : window.innerHeight
    const max = Math.max(0, (el ? el.scrollHeight : document.documentElement.scrollHeight) - view)
    switch (req.page) {
      case 'next':
        return { x: cur.x, y: Math.min(cur.y + view, max) }
      case 'prev':
        return { x: cur.x, y: Math.max(cur.y - view, 0) }
      case 'top':
        return { x: cur.x, y: 0 }
      case 'bottom':
        return { x: cur.x, y: max }
      default:
        return cur
    }
  }
  const atEndOf = (el: Element | null, reached: ScrollPos): boolean => {
    const view = el ? el.clientHeight : window.innerHeight
    const max = Math.max(0, (el ? el.scrollHeight : document.documentElement.scrollHeight) - view)
    return reached.y >= max - 1
  }

  const warnings: string[] = []
  let scroller: ScrollerKind = 'root'
  let reached: ScrollPos
  let scrollerEl: Element | null = null

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
    const pos = req.page ? pageTarget(el) : { x: req.x, y: req.y }
    scrollerEl = el
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
    const pos = req.page ? pageTarget(el) : { x: req.x, y: req.y }
    scrollerEl = el
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
    ipcRenderer.send(SCROLL_RESULT, {
      id: req.id,
      x: reached.x,
      y: reached.y,
      scroller,
      warnings,
      atEnd: atEndOf(scrollerEl, reached),
    } satisfies ScrollReport)
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

function accessibleName(el: HTMLSelectElement | HTMLInputElement, fallback: string): string {
  const explicit = el.getAttribute('aria-label')
  if (explicit) return cut(explicit)
  const label = el.labels?.[0]?.textContent?.trim()
  return label ? cut(label) : fallback
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
    ariaLabel: accessibleName(sel, 'Select'),
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

// --- date, time and colour pickers -------------------------------------------
// The picker Chromium hangs on these inputs is a widget too — a page popup
// for the dates, the colour panel — and offscreen it never opens, though the
// field still takes typing. So the press is reported to main, which has the
// overlay host an input of the same type over the element and click it:
// Chromium's own picker opens there, and every value it takes is written
// back here with the events a real pick fires. The press itself is left to
// Chromium for the date family — a click into a date field also picks the
// segment the keyboard edits, and that still works; a colour input has
// nothing to edit in place. See shared/pickerPopup.ts for the round trip.

const PICKER_OPEN = 'obsrv:picker-open' satisfies typeof IPC.pickerOpen
const PICKER_PICK = 'obsrv:picker-pick' satisfies typeof IPC.pickerPick
const PICKER_KINDS = ['date', 'time', 'datetime-local', 'month', 'week', 'color'] satisfies readonly PickerType[]
const VALUE_MAX = 64 satisfies typeof MAX_PICKER_VALUE

let nextPickerId = 1
/** The input each open request is for, and its value when the picker opened (what `change` compares against). */
const pendingPickers = new Map<number, { el: HTMLInputElement; initial: string }>()

function pickerInput(el: unknown): el is HTMLInputElement {
  return el instanceof HTMLInputElement && (PICKER_KINDS as readonly string[]).includes(el.type) && !el.disabled && !el.readOnly
}

/** An attribute longer than main accepts is dropped, not the request: the picker still opens. */
const bounded = (s: string): string => (s.length > VALUE_MAX ? '' : s)

function openPicker(el: HTMLInputElement): void {
  const id = nextPickerId++
  pendingPickers.set(id, { el, initial: el.value })
  const r = el.getBoundingClientRect()
  ipcRenderer.send(PICKER_OPEN, {
    id,
    rect: { x: r.left, y: r.top, width: r.width, height: r.height },
    type: el.type as PickerType,
    value: bounded(el.value),
    min: bounded(el.min),
    max: bounded(el.max),
    step: bounded(el.step),
    ariaLabel: accessibleName(el, 'Pick'),
  } satisfies PickerOpen)
}

if (IS_TARGET) {
  document.addEventListener(
    'mousedown',
    e => {
      const el = e.target
      if (e.button !== 0 || !pickerInput(el)) return
      if (el.type === 'color') {
        e.preventDefault()
        el.focus()
      }
      openPicker(el)
    },
    true,
  )
  // The keys that open a picker in Chromium; the digits and arrows that edit
  // a date field in place are left alone.
  document.addEventListener(
    'keydown',
    e => {
      const el = document.activeElement
      if (!pickerInput(el)) return
      if (e.key !== ' ' && e.key !== 'F4' && !(e.key === 'ArrowDown' && e.altKey)) return
      e.preventDefault()
      openPicker(el)
    },
    true,
  )
  ipcRenderer.on(PICKER_PICK, (_e, pick: PickerPick) => {
    const pending = pendingPickers.get(pick.id)
    if (pick.done) pendingPickers.delete(pick.id)
    if (!pending || pick.value === null) return
    const { el, initial } = pending
    if (!el.isConnected) return
    if (el.value !== pick.value) {
      el.value = pick.value
      el.dispatchEvent(new Event('input', { bubbles: true }))
    }
    if (pick.done && el.value !== initial) el.dispatchEvent(new Event('change', { bubbles: true }))
  })
}
