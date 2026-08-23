import type { InputModifier, TargetInputEvent } from '../../../shared/types'

/**
 * DOM events on the target canvas → `TargetInputEvent`s for `sendInputEvent`.
 * Pure functions over the few fields they read, so the maths tests in node.
 *
 * Every builder may return `null` (or `[]`): an event that has no faithful
 * Electron equivalent is dropped rather than sent as something it is not.
 * Callers must skip those.
 *
 * Known v1 limitation: `char` events only type what `sendInputEvent` accepts,
 * which in practice is ASCII. Dead keys and IME composition are filtered out
 * here, and other non-ASCII printable characters may not reach the page.
 */

/** Only the fields the bridge reads, so the maths tests without a DOM. */
export interface PointerLike {
  clientX: number
  clientY: number
  button?: number
  /** DOM `MouseEvent.buttons` bitmask: 1 = left, 2 = right, 4 = middle. */
  buttons?: number
  detail?: number
  shiftKey?: boolean
  ctrlKey?: boolean
  altKey?: boolean
  metaKey?: boolean
}

export interface WheelLike extends PointerLike {
  deltaX: number
  deltaY: number
  deltaMode: number
}

export interface KeyLike {
  key: string
  isComposing?: boolean
  shiftKey?: boolean
  ctrlKey?: boolean
  altKey?: boolean
  metaKey?: boolean
}

export interface CanvasRect {
  left: number
  top: number
}

/** Chromium's conversions for the non-pixel wheel delta modes. */
const PX_PER_LINE = 40
const PX_PER_PAGE = 800

const BUTTONS = ['left', 'middle', 'right'] as const
export type Button = (typeof BUTTONS)[number]

/** `MouseEvent.buttons` bits, per the DOM spec (note right is 2, middle is 4). */
const LEFT_BIT = 1
const RIGHT_BIT = 2
const MIDDLE_BIT = 4

export function modifiersOf(e: Omit<KeyLike, 'key'>): InputModifier[] {
  const m: InputModifier[] = []
  if (e.shiftKey) m.push('shift')
  if (e.ctrlKey) m.push('control')
  if (e.altKey) m.push('alt')
  if (e.metaKey) m.push('meta')
  return m
}

/** The pressed-button state Chromium needs to tell a drag from a hover. */
export function buttonModifiersOf(buttons: number | undefined): InputModifier[] {
  const b = buttons ?? 0
  const m: InputModifier[] = []
  if (b & LEFT_BIT) m.push('leftButtonDown')
  if (b & MIDDLE_BIT) m.push('middleButtonDown')
  if (b & RIGHT_BIT) m.push('rightButtonDown')
  return m
}

/**
 * Canvas-relative host pixels → target pixels. Positions are canvas
 * coordinates, so they divide by the magnification.
 */
export function toTargetPoint(
  e: Pick<PointerLike, 'clientX' | 'clientY'>,
  rect: CanvasRect,
  scale: number,
): { x: number; y: number } {
  return {
    x: Math.floor((e.clientX - rect.left) / scale),
    y: Math.floor((e.clientY - rect.top) / scale),
  }
}

/**
 * Returns `null` for a button Electron has no name for (back/forward and
 * beyond): forwarding those as `left` would be a phantom click.
 *
 * `mouseMove` ignores `button` (the DOM always reports 0 there) and takes it
 * from the pressed state instead, falling back to `left`, Chromium's neutral
 * default for a plain hover.
 */
export function mouseEvent(
  type: 'mouseDown' | 'mouseUp' | 'mouseMove',
  e: PointerLike,
  rect: CanvasRect,
  scale: number,
): TargetInputEvent | null {
  let button: Button
  if (type === 'mouseMove') {
    const b = e.buttons ?? 0
    button = b & LEFT_BIT ? 'left' : b & MIDDLE_BIT ? 'middle' : b & RIGHT_BIT ? 'right' : 'left'
  } else {
    const named = BUTTONS[e.button ?? 0]
    if (!named) return null
    button = named
  }
  const { x, y } = toTargetPoint(e, rect, scale)
  return {
    type,
    x,
    y,
    button,
    clickCount: e.detail ?? 1,
    modifiers: [...modifiersOf(e), ...buttonModifiersOf(e.buttons)],
  }
}

/**
 * Wheel deltas are scroll amounts in CSS pixels, not canvas coordinates, so
 * they pass through unscaled: one notch moves both panes by the same number of
 * CSS pixels, which is exactly what SyncBus then mirrors.
 *
 * The sign flips because the DOM counts a downward scroll as positive and
 * Chromium's native wheel event counts it as negative.
 *
 * A wheel with ctrl or meta held is the browser's pinch-zoom gesture; it is
 * dropped (`null`) because zooming the target would break the 1x contract.
 */
export function wheelEvent(
  e: WheelLike,
  rect: CanvasRect,
  scale: number,
): TargetInputEvent | null {
  if (e.ctrlKey || e.metaKey) return null
  const factor = e.deltaMode === 1 ? PX_PER_LINE : e.deltaMode === 2 ? PX_PER_PAGE : 1
  const { x, y } = toTargetPoint(e, rect, scale)
  return {
    type: 'mouseWheel',
    x,
    y,
    deltaX: -e.deltaX * factor,
    deltaY: -e.deltaY * factor,
    modifiers: modifiersOf(e),
  }
}

/** Keys whose Electron accelerator name differs from `KeyboardEvent.key`. */
const KEY_ALIASES: Record<string, string> = {
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Enter: 'Return',
  ' ': 'Space',
}

export function electronKeyCode(key: string): string {
  return KEY_ALIASES[key] ?? key
}

/** A key that produces text; Electron needs a separate `char` event for it. */
function isPrintable(key: string): boolean {
  return [...key].length === 1
}

/** `KeyboardEvent.key` values with no key behind them (dead keys, IME). */
const UNSENDABLE_KEYS: ReadonlySet<string> = new Set(['Dead', 'Unidentified', 'Process'])

function isSendable(e: KeyLike): boolean {
  return !e.isComposing && !UNSENDABLE_KEYS.has(e.key)
}

export function keyDownEvents(e: KeyLike): TargetInputEvent[] {
  if (!isSendable(e)) return []
  const modifiers = modifiersOf(e)
  const events: TargetInputEvent[] = [
    { type: 'keyDown', keyCode: electronKeyCode(e.key), modifiers },
  ]
  // No `char` when the key is part of a shortcut — that would type the letter.
  if (isPrintable(e.key) && !e.ctrlKey && !e.metaKey) {
    events.push({ type: 'char', keyCode: e.key, modifiers })
  }
  return events
}

export function keyUpEvent(e: KeyLike): TargetInputEvent | null {
  if (!isSendable(e)) return null
  return { type: 'keyUp', keyCode: electronKeyCode(e.key), modifiers: modifiersOf(e) }
}
