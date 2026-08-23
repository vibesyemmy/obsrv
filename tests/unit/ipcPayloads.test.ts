import { describe, expect, it } from 'vitest'
import { MAX_RECT, parseInputEvent, parseMode, parseRect, parseScrollPos, parseSettings } from '../../src/shared/ipcPayloads'

describe('parseRect', () => {
  it('accepts a sane rect and rounds to integers', () => {
    expect(parseRect({ x: 10.4, y: 50.6, width: 300, height: 200 })).toEqual({ x: 10, y: 51, width: 300, height: 200 })
  })
  it('accepts zero-sized rects', () => {
    expect(parseRect({ x: 0, y: 0, width: 0, height: 0 })).toEqual({ x: 0, y: 0, width: 0, height: 0 })
  })
  it.each([
    ['not an object', 'rect'],
    ['null', null],
    ['missing fields', {}],
    ['string field', { x: '10', y: 0, width: 1, height: 1 }],
    ['NaN', { x: NaN, y: 0, width: 1, height: 1 }],
    ['Infinity', { x: 0, y: 0, width: Infinity, height: 1 }],
    ['negative origin', { x: -1, y: 0, width: 1, height: 1 }],
    ['negative size', { x: 0, y: 0, width: 1, height: -1 }],
    ['absurd size', { x: 0, y: 0, width: MAX_RECT + 1, height: 1 }],
  ])('rejects %s', (_name, raw) => {
    expect(parseRect(raw)).toBeNull()
  })
})

describe('parseInputEvent', () => {
  it('accepts a mouse event and keeps only known modifiers', () => {
    expect(
      parseInputEvent({ type: 'mouseDown', x: 1, y: 2, button: 'left', clickCount: 1, modifiers: ['shift', 'bogus', 42] }),
    ).toEqual({ type: 'mouseDown', x: 1, y: 2, button: 'left', clickCount: 1, modifiers: ['shift'] })
  })
  it('accepts a wheel event', () => {
    expect(parseInputEvent({ type: 'mouseWheel', x: 1, y: 2, deltaX: 0, deltaY: -120, modifiers: [] })).toEqual({
      type: 'mouseWheel',
      x: 1,
      y: 2,
      deltaX: 0,
      deltaY: -120,
      modifiers: [],
    })
  })
  it('accepts the pressed-button modifiers a drag carries', () => {
    expect(
      parseInputEvent({ type: 'mouseMove', x: 3, y: 4, button: 'left', clickCount: 1, modifiers: ['leftButtonDown', 'shift', 'rightButtonDown', 'middleButtonDown'] }),
    ).toEqual({ type: 'mouseMove', x: 3, y: 4, button: 'left', clickCount: 1, modifiers: ['leftButtonDown', 'shift', 'rightButtonDown', 'middleButtonDown'] })
  })
  it('accepts key events and treats a missing modifiers list as empty', () => {
    expect(parseInputEvent({ type: 'keyDown', keyCode: 'a' })).toEqual({ type: 'keyDown', keyCode: 'a', modifiers: [] })
    expect(parseInputEvent({ type: 'char', keyCode: 'a', modifiers: ['meta'] })).toEqual({ type: 'char', keyCode: 'a', modifiers: ['meta'] })
  })
  it('never passes unknown keys through', () => {
    expect(parseInputEvent({ type: 'keyUp', keyCode: 'a', modifiers: [], extra: 1 })).toEqual({ type: 'keyUp', keyCode: 'a', modifiers: [] })
  })
  it.each([
    ['not an object', 'mouseDown'],
    ['unknown type', { type: 'nope' }],
    ['mouse without coordinates', { type: 'mouseDown', button: 'left', clickCount: 1 }],
    ['mouse with NaN', { type: 'mouseMove', x: NaN, y: 0, button: 'left', clickCount: 0 }],
    ['unknown button', { type: 'mouseUp', x: 0, y: 0, button: 'back', clickCount: 1 }],
    ['non-numeric clickCount', { type: 'mouseDown', x: 0, y: 0, button: 'left', clickCount: '1' }],
    ['wheel without deltas', { type: 'mouseWheel', x: 0, y: 0 }],
    ['key without keyCode', { type: 'keyDown' }],
    ['key with numeric keyCode', { type: 'keyDown', keyCode: 65 }],
  ])('rejects %s', (_name, raw) => {
    expect(parseInputEvent(raw)).toBeNull()
  })
})

describe('parseSettings', () => {
  it('copies exactly the two known keys', () => {
    expect(parseSettings({ hostDiagonalInches: 27, hostNits: 500, extra: 1 })).toEqual({ hostDiagonalInches: 27, hostNits: 500 })
  })
  it.each([
    ['not an object', 27],
    ['zero diagonal', { hostDiagonalInches: 0, hostNits: 400 }],
    ['negative nits', { hostDiagonalInches: 27, hostNits: -1 }],
    ['Infinity', { hostDiagonalInches: Infinity, hostNits: 400 }],
    ['string', { hostDiagonalInches: '27', hostNits: 400 }],
    ['missing key', { hostDiagonalInches: 27 }],
  ])('rejects %s', (_name, raw) => {
    expect(parseSettings(raw)).toBeNull()
  })
})

describe('parseMode', () => {
  it('accepts the two modes', () => {
    expect(parseMode('url')).toBe('url')
    expect(parseMode('image')).toBe('image')
  })
  it.each(['bogus', '', 1, null, undefined, {}])('rejects %j', raw => {
    expect(parseMode(raw)).toBeNull()
  })
})

describe('parseScrollPos', () => {
  it('copies exactly x and y', () => {
    expect(parseScrollPos({ x: 12.5, y: 0, extra: 1 })).toEqual({ x: 12.5, y: 0 })
  })
  it.each([
    ['not an object', 12],
    ['null', null],
    ['negative x', { x: -1, y: 0 }],
    ['negative y', { x: 0, y: -0.5 }],
    ['NaN', { x: NaN, y: 0 }],
    ['Infinity', { x: 0, y: Infinity }],
    ['string', { x: '0', y: 0 }],
    ['missing key', { x: 0 }],
  ])('rejects %s', (_name, raw) => {
    expect(parseScrollPos(raw)).toBeNull()
  })
})
