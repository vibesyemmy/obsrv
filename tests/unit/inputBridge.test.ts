import { describe, it, expect } from 'vitest'
import {
  buttonModifiersOf,
  electronKeyCode,
  keyDownEvents,
  keyUpEvent,
  modifiersOf,
  mouseEvent,
  toTargetPoint,
  wheelEvent,
} from '../../src/renderer/src/input/inputBridge'

const RECT = { left: 20, top: 10 }

describe('toTargetPoint', () => {
  it('subtracts the canvas origin and divides by the magnification', () => {
    expect(toTargetPoint({ clientX: 220, clientY: 110 }, RECT, 2)).toEqual({ x: 100, y: 50 })
  })
  it('floors to whole target pixels', () => {
    expect(toTargetPoint({ clientX: 221, clientY: 111 }, RECT, 2)).toEqual({ x: 100, y: 50 })
  })
  it('is a pass-through at scale 1', () => {
    expect(toTargetPoint({ clientX: 20, clientY: 10 }, RECT, 1)).toEqual({ x: 0, y: 0 })
  })
})

describe('modifiersOf', () => {
  it('maps the four browser modifier flags to Electron names', () => {
    expect(modifiersOf({})).toEqual([])
    expect(modifiersOf({ shiftKey: true, metaKey: true })).toEqual(['shift', 'meta'])
    expect(modifiersOf({ ctrlKey: true, altKey: true })).toEqual(['control', 'alt'])
  })
})

describe('mouseEvent', () => {
  it('carries the button, the click count and the scaled position', () => {
    expect(
      mouseEvent('mouseDown', { clientX: 220, clientY: 110, button: 2, detail: 2 }, RECT, 2),
    ).toEqual({
      type: 'mouseDown',
      x: 100,
      y: 50,
      button: 'right',
      clickCount: 2,
      modifiers: [],
    })
  })
  it('defaults to a single left click', () => {
    const ev = mouseEvent('mouseMove', { clientX: 20, clientY: 10 }, RECT, 1)
    expect(ev).toMatchObject({ button: 'left', clickCount: 1 })
  })
  it('drops buttons Electron has no name for instead of faking a left click', () => {
    expect(mouseEvent('mouseDown', { clientX: 20, clientY: 10, button: 3 }, RECT, 1)).toBeNull()
    expect(mouseEvent('mouseUp', { clientX: 20, clientY: 10, button: 4 }, RECT, 1)).toBeNull()
  })
  it('carries the pressed-button state on a move, so a drag reads as a drag', () => {
    expect(mouseEvent('mouseMove', { clientX: 20, clientY: 10, buttons: 1 }, RECT, 1)).toEqual({
      type: 'mouseMove',
      x: 0,
      y: 0,
      button: 'left',
      clickCount: 1,
      modifiers: ['leftButtonDown'],
    })
    expect(
      mouseEvent('mouseMove', { clientX: 20, clientY: 10, buttons: 2, shiftKey: true }, RECT, 1),
    ).toMatchObject({ button: 'right', modifiers: ['shift', 'rightButtonDown'] })
    expect(mouseEvent('mouseMove', { clientX: 20, clientY: 10, buttons: 4 }, RECT, 1)).toMatchObject({
      button: 'middle',
      modifiers: ['middleButtonDown'],
    })
    expect(
      mouseEvent('mouseDown', { clientX: 20, clientY: 10, button: 0, buttons: 1 }, RECT, 1),
    ).toMatchObject({ button: 'left', modifiers: ['leftButtonDown'] })
  })
  it('decodes the DOM buttons bitmask (right is 2, middle is 4)', () => {
    expect(buttonModifiersOf(undefined)).toEqual([])
    expect(buttonModifiersOf(7)).toEqual(['leftButtonDown', 'middleButtonDown', 'rightButtonDown'])
  })
})

describe('wheelEvent', () => {
  it('scales the position but not the delta, and flips the sign', () => {
    expect(
      wheelEvent(
        { clientX: 220, clientY: 110, deltaX: 5, deltaY: 100, deltaMode: 0 },
        RECT,
        2,
      ),
    ).toEqual({ type: 'mouseWheel', x: 100, y: 50, deltaX: -5, deltaY: -100, modifiers: [] })
  })
  it('converts line and page deltas to pixels', () => {
    const lines = wheelEvent(
      { clientX: 20, clientY: 10, deltaX: 0, deltaY: 3, deltaMode: 1 },
      RECT,
      1,
    )
    expect(lines).toMatchObject({ deltaY: -120 })

    const pages = wheelEvent(
      { clientX: 20, clientY: 10, deltaX: 0, deltaY: 1, deltaMode: 2 },
      RECT,
      1,
    )
    expect(pages).toMatchObject({ deltaY: -800 })
  })
  it('drops ctrl/meta wheel, which is the pinch-zoom gesture', () => {
    const base = { clientX: 20, clientY: 10, deltaX: 0, deltaY: 10, deltaMode: 0 }
    expect(wheelEvent({ ...base, ctrlKey: true }, RECT, 1)).toBeNull()
    expect(wheelEvent({ ...base, metaKey: true }, RECT, 1)).toBeNull()
    expect(wheelEvent({ ...base, shiftKey: true }, RECT, 1)).toMatchObject({ modifiers: ['shift'] })
  })
})

describe('keyboard', () => {
  it('renames the keys Electron spells differently', () => {
    expect(electronKeyCode('ArrowLeft')).toBe('Left')
    expect(electronKeyCode('Enter')).toBe('Return')
    expect(electronKeyCode(' ')).toBe('Space')
    expect(electronKeyCode('Backspace')).toBe('Backspace')
    expect(electronKeyCode('a')).toBe('a')
  })
  it('emits keyDown then char for a printable key', () => {
    expect(keyDownEvents({ key: 'a' })).toEqual([
      { type: 'keyDown', keyCode: 'a', modifiers: [] },
      { type: 'char', keyCode: 'a', modifiers: [] },
    ])
  })
  it('emits keyDown alone for a non-printable key', () => {
    expect(keyDownEvents({ key: 'Enter' })).toEqual([
      { type: 'keyDown', keyCode: 'Return', modifiers: [] },
    ])
  })
  it('suppresses char when the key is part of a shortcut', () => {
    expect(keyDownEvents({ key: 'r', metaKey: true })).toEqual([
      { type: 'keyDown', keyCode: 'r', modifiers: ['meta'] },
    ])
  })
  it('reports key release', () => {
    expect(keyUpEvent({ key: 'ArrowDown', shiftKey: true })).toEqual({
      type: 'keyUp',
      keyCode: 'Down',
      modifiers: ['shift'],
    })
  })
  it('drops dead keys and IME composition', () => {
    expect(keyDownEvents({ key: 'Dead' })).toEqual([])
    expect(keyDownEvents({ key: 'Unidentified' })).toEqual([])
    expect(keyDownEvents({ key: 'Process' })).toEqual([])
    expect(keyDownEvents({ key: 'a', isComposing: true })).toEqual([])
    expect(keyUpEvent({ key: 'Dead' })).toBeNull()
    expect(keyUpEvent({ key: 'a', isComposing: true })).toBeNull()
  })
})
