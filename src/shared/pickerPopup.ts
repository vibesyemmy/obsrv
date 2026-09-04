import type { Rect } from './api'

/**
 * A date, time or colour input on the target page, given a picker by Obsrv.
 *
 * Like a select's popup (shared/selectPopup.ts), the picker Chromium hangs
 * on these inputs is a widget outside the page's compositor — the calendar
 * is a page popup, the colour chooser a native panel — and an offscreen
 * window has nothing to hang it on: the field takes typing, the picker
 * never opens. Unlike a select, the picker is not a list Obsrv could draw
 * in a menu. So the overlay view, a real onscreen page, hosts an invisible
 * `<input>` of the same type over the element's box on the canvas, main
 * clicks it once as a user would — a trusted event, which is what opens a
 * picker — and Chromium draws its own. Every value the hosted input takes
 * is written into the page's element with the events a real pick fires:
 * `input` while the picker is being dragged, `change` when it commits.
 *
 * Types only: `src/preload/sync.ts` imports from here and must not share a
 * runtime module with the other preload (see its header).
 */

/** The input types whose picker is a widget; `HTMLInputElement.type` values. */
export const PICKER_TYPES = ['date', 'time', 'datetime-local', 'month', 'week', 'color'] as const
export type PickerType = (typeof PICKER_TYPES)[number]

export function isPickerType(type: string): type is PickerType {
  return (PICKER_TYPES as readonly string[]).includes(type)
}

/** Longest value, `min`, `max` or `step` carried; a datetime-local is 19 characters. */
export const MAX_PICKER_VALUE = 64 as const

/** Preload → main: an input wants its picker. */
export interface PickerOpen {
  /** Per-document counter, so a late value cannot land on a later input. */
  id: number
  /** The input's box in the page's own CSS px (viewport-relative). */
  rect: Rect
  type: PickerType
  value: string
  min: string
  max: string
  step: string
  ariaLabel: string
}

/** Main → chrome: the same, on a tab, with the box in surface CSS px. */
export interface PickerPopup extends PickerOpen {
  tabId: string
}

/** Chrome → main → overlay: host this input at this anchor (window coordinates). */
export interface PickerRequest {
  tabId: string
  id: number
  type: PickerType
  value: string
  min: string
  max: string
  step: string
  ariaLabel: string
  anchor: Rect
}

/** Overlay → main → preload: a value the hosted input took; `done` on commit. */
export interface PickerEvent {
  value: string
  done: boolean
}

/** Main → preload: what to write into the element; a null value is a dismissal, nothing written. */
export interface PickerPick {
  id: number
  value: string | null
  done: boolean
}
