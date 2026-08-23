import type { InputModifier, TargetInputEvent } from '../../../shared/types'

/** Only the fields the bridge reads, so the maths tests without a DOM. */
export interface PointerLike {
  clientX: number
  clientY: number
  button?: number
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

export function modifiersOf(e: Omit<KeyLike, 'key'>): InputModifier[] {
  const m: InputModifier[] = []
  if (e.shiftKey) m.push('shift')
  if (e.ctrlKey) m.push('control')
  if (e.altKey) m.push('alt')
  if (e.metaKey) m.push('meta')
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

export function mouseEvent(
  type: 'mouseDown' | 'mouseUp' | 'mouseMove',
  e: PointerLike,
  rect: CanvasRect,
  scale: number,
): TargetInputEvent {
  const { x, y } = toTargetPoint(e, rect, scale)
  return {
    type,
    x,
    y,
    button: BUTTONS[e.button ?? 0] ?? 'left',
    clickCount: e.detail ?? 1,
    modifiers: modifiersOf(e),
  }
}

/**
 * Wheel deltas are scroll amounts in CSS pixels, not canvas coordinates, so
 * they pass through unscaled: one notch moves both panes by the same number of
 * CSS pixels, which is exactly what SyncBus then mirrors.
 *
 * The sign flips because the DOM counts a downward scroll as positive and
 * Chromium's native wheel event counts it as negative.
 */
export function wheelEvent(e: WheelLike, rect: CanvasRect, scale: number): TargetInputEvent {
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

export function keyDownEvents(e: KeyLike): TargetInputEvent[] {
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

export function keyUpEvent(e: KeyLike): TargetInputEvent {
  return { type: 'keyUp', keyCode: electronKeyCode(e.key), modifiers: modifiersOf(e) }
}
