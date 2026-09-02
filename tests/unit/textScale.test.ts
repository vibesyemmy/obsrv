import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TEXT_SCALE,
  MAX_TEXT_SCALE,
  MIN_TEXT_SCALE,
  TEXT_SCALES,
  formatTextScale,
  isTextScale,
  parseTextScale,
} from '../../src/shared/textScale'

describe('textScale', () => {
  it('the menu offers 100 / 125 / 150 / 200 %, in that order, and every one is in range', () => {
    expect(TEXT_SCALES).toEqual([1, 1.25, 1.5, 2])
    for (const s of TEXT_SCALES) expect(isTextScale(s)).toBe(true)
    expect(DEFAULT_TEXT_SCALE).toBe(1)
  })
  it('isTextScale: a finite number within the range; nothing else', () => {
    expect(isTextScale(MIN_TEXT_SCALE)).toBe(true)
    expect(isTextScale(MAX_TEXT_SCALE)).toBe(true)
    expect(isTextScale(1.75)).toBe(true)
    for (const bad of [0, 0.49, 4.01, -1, Number.NaN, Number.POSITIVE_INFINITY, '1.5', null, undefined, {}]) {
      expect(isTextScale(bad)).toBe(false)
    }
  })
  it('parseTextScale: absent is the default, in range is itself, out of range is refused not clamped', () => {
    expect(parseTextScale(undefined)).toBe(1)
    expect(parseTextScale(1.5)).toBe(1.5)
    expect(parseTextScale(10)).toBeNull()
    expect(parseTextScale('2')).toBeNull()
    expect(parseTextScale(null)).toBeNull()
  })
  it('formatTextScale: a whole percentage', () => {
    expect(formatTextScale(1)).toBe('100%')
    expect(formatTextScale(1.25)).toBe('125%')
    expect(formatTextScale(1.5)).toBe('150%')
    expect(formatTextScale(4 / 3)).toBe('133%')
  })
})
