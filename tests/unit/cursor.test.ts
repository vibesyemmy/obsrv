import { describe, expect, it } from 'vitest'
import { DEFAULT_CURSOR, cursorCss } from '../../src/shared/cursor'

describe('cursorCss', () => {
  it("maps Chromium's names, including the two traps: `pointer` is the arrow, `hand` is the link hand", () => {
    expect(cursorCss('pointer')).toBe('default')
    expect(cursorCss('hand')).toBe('pointer')
    expect(cursorCss('text')).toBe('text')
    expect(cursorCss('nodrop')).toBe('no-drop')
    expect(cursorCss('nwse-resize')).toBe('nwse-resize')
    expect(cursorCss('grabbing')).toBe('grabbing')
    expect(cursorCss('drag-drop-link')).toBe('alias')
    expect(cursorCss('m-panning')).toBe('all-scroll')
  })
  it('anything unknown is the arrow', () => {
    for (const bad of ['', 'sparkle', 'url(x)', 'null; background: red']) expect(cursorCss(bad)).toBe(DEFAULT_CURSOR)
    expect(cursorCss('null')).toBe(DEFAULT_CURSOR)
  })
  it('a custom cursor is its PNG with the hotspot and the arrow as fallback', () => {
    const png = 'data:image/png;base64,iVBORw0KGgo='
    expect(cursorCss('custom', { dataUrl: png, hotspot: { x: 3.4, y: 7.6 } })).toBe(`url("${png}") 3 8, auto`)
    expect(cursorCss('custom', { dataUrl: png, hotspot: { x: -2, y: 0 } })).toBe(`url("${png}") 0 0, auto`)
  })
  it('a custom cursor without a usable PNG is the arrow, never a URL of something else', () => {
    expect(cursorCss('custom')).toBe(DEFAULT_CURSOR)
    expect(cursorCss('custom', { dataUrl: 'https://evil.test/x.png', hotspot: { x: 0, y: 0 } })).toBe(DEFAULT_CURSOR)
    expect(cursorCss('custom', { dataUrl: 'data:image/svg+xml,<svg/>', hotspot: { x: 0, y: 0 } })).toBe(DEFAULT_CURSOR)
    expect(cursorCss('custom', { dataUrl: 'data:image/png;base64,AA") 0 0, auto; x: url("', hotspot: { x: 0, y: 0 } })).toBe(DEFAULT_CURSOR)
  })
})
