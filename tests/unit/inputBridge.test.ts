import { describe, it, expect } from 'vitest'
import {
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
})
