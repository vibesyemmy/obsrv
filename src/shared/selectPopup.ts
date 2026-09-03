import type { MenuGroup, Rect } from './api'

/**
 * A `<select>` on the target page, opened by Obsrv instead of by Chromium.
 *
 * The target is an offscreen window, and a select's popup is a widget
 * Chromium draws outside the page's compositor — on macOS a native menu
 * hung on the window. Offscreen there is nothing to hang it on: the select
 * reports itself open, swallows the keyboard, and shows nothing. So the
 * target preload catches the press before Chromium acts on it and reports
 * the options here; main hands them to the chrome, which draws them in the
 * overlay menu the toolbar's own controls use, anchored over the select on
 * the canvas; the pick goes back the same way and the preload writes it into
 * the element with the events a real pick would fire.
 *
 * Option values are indexes into `select.options`, as strings, so a label
 * that repeats or an empty value still maps back to one row.
 *
 * Types only: `src/preload/sync.ts` imports from here and must not share a
 * runtime module with the other preload (see its header).
 */

/** Rows one select may offer. A country list is ~250; a thousand covers the real ones. */
export const MAX_SELECT_OPTIONS = 1000 as const

/** Preload → main: a select wants a popup. */
export interface SelectOpen {
  /** Per-document counter, so a late pick cannot land on a later select. */
  id: number
  /** The select's box in the page's own CSS px (viewport-relative). */
  rect: Rect
  selectedIndex: number
  ariaLabel: string
  groups: MenuGroup[]
}

/** Main → chrome: the same, on a tab, with the box in surface CSS px. */
export interface SelectPopup extends SelectOpen {
  tabId: string
}

/** Chrome → main: the row the user chose, or null for a dismissal. */
export interface SelectResult {
  tabId: string
  id: number
  index: number | null
}

/** Main → preload: what to write into the element. */
export interface SelectPick {
  id: number
  index: number | null
}
