import { describe, expect, it } from 'vitest'
import {
  MAX_RECT,
  parseDeviceScaleFactor,
  parseInputEvent,
  parseMode,
  parseRect,
  parseScrollPos,
  parseScrollReport,
  parseScrollRequest,
  parseSettings,
  parseUiState,
} from '../../src/shared/ipcPayloads'
import { MAX_SCROLL_SELECTOR } from '../../src/shared/types'

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
  it('carries canvasBounds, and nulls it when absent or malformed', () => {
    const base = { presetId: 'laptop-768', profileId: 'reference', viewMode: '1:1', mode: 'url' }
    expect(parseUiState({ ...base, canvasBounds: { x: 10, y: 20, width: 300, height: 400 } })?.canvasBounds).toEqual({
      x: 10,
      y: 20,
      width: 300,
      height: 400,
    })
    expect(parseUiState(base)?.canvasBounds).toBeNull()
    expect(parseUiState({ ...base, canvasBounds: { x: 'a' } })?.canvasBounds).toBeNull()
  })

  it('copies exactly the known keys', () => {
    expect(
      parseSettings({
        hostDiagonalInches: 27,
        hostNits: 500,
        agentControl: true,
        updateCheck: false,
        lastUpdateCheck: 1700000000000,
        recordHistory: false,
        split: 0.7,
        extra: 1,
      }),
    ).toEqual({
      hostDiagonalInches: 27,
      hostNits: 500,
      agentControl: true,
      updateCheck: false,
      lastUpdateCheck: 1700000000000,
      recordHistory: false,
      split: 0.7,
    })
  })
  it('defaults a missing agentControl to false (the pre-live-drive wire shape)', () => {
    expect(parseSettings({ hostDiagonalInches: 27, hostNits: 500 })).toEqual({
      hostDiagonalInches: 27,
      hostNits: 500,
      agentControl: false,
      // The opposite default: absent means on, so a renderer from before this
      // feature does not silently disable the check when it saves settings.
      updateCheck: true,
      lastUpdateCheck: 0,
      // And likewise for history, which is on by default for the same reason.
      recordHistory: true,
      // Likewise for the split: a renderer that has never heard of it must
      // not be read as asking for a degenerate one.
      split: 0.5,
    })
  })
  it.each([
    ['not an object', 27],
    ['zero diagonal', { hostDiagonalInches: 0, hostNits: 400 }],
    ['negative nits', { hostDiagonalInches: 27, hostNits: -1 }],
    ['Infinity', { hostDiagonalInches: Infinity, hostNits: 400 }],
    ['string', { hostDiagonalInches: '27', hostNits: 400 }],
    ['missing key', { hostDiagonalInches: 27 }],
    ['truthy non-boolean agentControl', { hostDiagonalInches: 27, hostNits: 400, agentControl: 1 }],
    ['string agentControl', { hostDiagonalInches: 27, hostNits: 400, agentControl: 'true' }],
    // Unlike `loadSettings`, which forgives whatever is on disk: the renderer
    // clamps before it sends, so an out-of-band ratio on the wire is a bug.
    ['truthy non-boolean recordHistory', { hostDiagonalInches: 27, hostNits: 400, recordHistory: 1 }],
    ['split below the band', { hostDiagonalInches: 27, hostNits: 400, split: 0.05 }],
    ['split above the band', { hostDiagonalInches: 27, hostNits: 400, split: 0.97 }],
    ['string split', { hostDiagonalInches: 27, hostNits: 400, split: '0.5' }],
    ['NaN split', { hostDiagonalInches: 27, hostNits: 400, split: NaN }],
  ])('rejects %s', (_name, raw) => {
    expect(parseSettings(raw)).toBeNull()
  })
})

describe('parseUiState', () => {
  const good = { presetId: 'laptop-768', profileId: 'reference', viewMode: 'fit', panes: 'both', mode: 'url' }
  /** Both rects default to null before the renderer has measured. */
  const unmeasured = { targetBounds: null, canvasBounds: null }
  it('copies exactly the known keys; missing targetBounds means null (pre-mount)', () => {
    expect(parseUiState({ ...good, extra: 1 })).toEqual({ ...good, ...unmeasured })
  })
  it('carries a solo-target report, and defaults panes when the field is absent', () => {
    expect(parseUiState({ ...good, panes: 'target' })?.panes).toBe('target')
    expect(parseUiState({ ...good, panes: undefined })?.panes).toBe('both')
  })
  it('carries ids main does not know (the report describes renderer state)', () => {
    expect(parseUiState({ ...good, presetId: 'custom' })).toEqual({ ...good, presetId: 'custom', ...unmeasured })
  })
  it('carries the target pane bounds, rounded like any pane rect', () => {
    expect(parseUiState({ ...good, targetBounds: { x: 683.4, y: 44, width: 682.6, height: 700 } })).toEqual({
      ...good,
      canvasBounds: null,
      targetBounds: { x: 683, y: 44, width: 683, height: 700 },
    })
  })
  it('drops malformed bounds without losing the rest of the report', () => {
    expect(parseUiState({ ...good, targetBounds: { x: -1, y: 0, width: 10, height: 10 } })).toEqual({
      ...good,
      ...unmeasured,
    })
    expect(parseUiState({ ...good, targetBounds: 'rect' })).toEqual({ ...good, ...unmeasured })
  })
  it.each([
    ['not an object', 'url'],
    ['empty presetId', { ...good, presetId: '' }],
    ['oversized presetId', { ...good, presetId: 'x'.repeat(65) }],
    ['numeric profileId', { ...good, profileId: 7 }],
    ['bad viewMode', { ...good, viewMode: 'fill' }],
    ['bad mode', { ...good, mode: 'video' }],
    ['bad panes', { ...good, panes: 'native' }],
    ['missing mode', { presetId: 'a', profileId: 'b', viewMode: '1:1' }],
  ])('rejects %s', (_name, raw) => {
    expect(parseUiState(raw)).toBeNull()
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

describe('parseDeviceScaleFactor', () => {
  it('accepts factors between 1 and 4', () => {
    expect(parseDeviceScaleFactor(1)).toBe(1)
    expect(parseDeviceScaleFactor(2)).toBe(2)
    expect(parseDeviceScaleFactor(3)).toBe(3)
    expect(parseDeviceScaleFactor(4)).toBe(4)
    expect(parseDeviceScaleFactor(1.5)).toBe(1.5)
  })
  it('defaults a missing factor to 1', () => {
    expect(parseDeviceScaleFactor(undefined)).toBe(1)
  })
  it.each([
    ['zero', 0],
    ['below one', 0.5],
    ['above four', 4.1],
    ['negative', -2],
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['string', '2'],
    ['null', null],
    ['object', {}],
  ])('rejects %s', (_name, raw) => {
    expect(parseDeviceScaleFactor(raw)).toBeNull()
  })
})

describe('parseScrollRequest', () => {
  it('accepts a bare offset', () => {
    expect(parseScrollRequest({ x: 0, y: 1500 })).toEqual({ x: 0, y: 1500 })
  })
  it('accepts and trims a scrollSelector', () => {
    expect(parseScrollRequest({ x: 0, y: 10, scrollSelector: '  .landing-v2 ' })).toEqual({ x: 0, y: 10, selector: '.landing-v2' })
  })
  it('treats a missing or null selector as absent', () => {
    expect(parseScrollRequest({ x: 1, y: 2, scrollSelector: null })).toEqual({ x: 1, y: 2 })
  })
  it.each([
    ['a bad offset', { x: -1, y: 0 }],
    ['a non-string selector', { x: 0, y: 0, scrollSelector: 42 }],
    ['an empty selector', { x: 0, y: 0, scrollSelector: '   ' }],
    ['an over-long selector', { x: 0, y: 0, scrollSelector: 'a'.repeat(MAX_SCROLL_SELECTOR + 1) }],
  ])('refuses %s with a message', (_name, raw) => {
    expect(typeof parseScrollRequest(raw)).toBe('string')
  })
})

describe('parseScrollReport', () => {
  it('accepts a well-formed reply', () => {
    expect(parseScrollReport({ id: 3, x: 0, y: 1500, scroller: 'element', warnings: ['hm'] })).toEqual({
      id: 3,
      x: 0,
      y: 1500,
      scroller: 'element',
      warnings: ['hm'],
    })
  })
  it('defaults missing warnings to an empty list and drops non-strings', () => {
    expect(parseScrollReport({ id: 1, x: 0, y: 0, scroller: 'root' })?.warnings).toEqual([])
    expect(parseScrollReport({ id: 1, x: 0, y: 0, scroller: 'root', warnings: [1, 'ok'] })?.warnings).toEqual(['ok'])
  })
  it.each([
    ['not an object', 'nope'],
    ['a missing id', { x: 0, y: 0, scroller: 'root' }],
    ['a non-numeric offset', { id: 1, x: '0', y: 0, scroller: 'root' }],
    ['an unknown scroller kind', { id: 1, x: 0, y: 0, scroller: 'window' }],
  ])('rejects %s', (_name, raw) => {
    expect(parseScrollReport(raw)).toBeNull()
  })
})
