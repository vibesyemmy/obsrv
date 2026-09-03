import { describe, expect, it } from 'vitest'
import { parsePickerEvent, parsePickerOpen, parsePickerRequest } from '../../src/shared/ipcPayloads'
import { isPickerType, PICKER_TYPES } from '../../src/shared/pickerPopup'

const good = {
  id: 2,
  rect: { x: 10.4, y: 20.6, width: 160, height: 24 },
  type: 'date',
  value: '2026-09-02',
  min: '2026-01-01',
  max: '',
  step: '',
  ariaLabel: 'Start',
}

describe('picker types', () => {
  it('are the six inputs whose picker is a widget', () => {
    expect(PICKER_TYPES).toEqual(['date', 'time', 'datetime-local', 'month', 'week', 'color'])
    expect(isPickerType('color')).toBe(true)
    expect(isPickerType('text')).toBe(false)
    expect(isPickerType('file')).toBe(false)
  })
})

describe('parsePickerOpen', () => {
  it('accepts a request and rounds the rect like any pane rect', () => {
    expect(parsePickerOpen(good)).toEqual({ ...good, rect: { x: 10, y: 21, width: 160, height: 24 } })
  })
  it('refuses a type that has no picker, a bad id, a bad rect, an overlong label', () => {
    expect(parsePickerOpen({ ...good, type: 'text' })).toBeNull()
    expect(parsePickerOpen({ ...good, type: 3 })).toBeNull()
    expect(parsePickerOpen({ ...good, id: 0 })).toBeNull()
    expect(parsePickerOpen({ ...good, rect: { x: 0, y: 0, width: -1, height: 24 } })).toBeNull()
    expect(parsePickerOpen({ ...good, ariaLabel: 'x'.repeat(121) })).toBeNull()
    expect(parsePickerOpen(null)).toBeNull()
  })
  it('bounds every text field at 64 characters and requires each to be a string', () => {
    expect(parsePickerOpen({ ...good, value: 'v'.repeat(64) })).not.toBeNull()
    expect(parsePickerOpen({ ...good, value: 'v'.repeat(65) })).toBeNull()
    expect(parsePickerOpen({ ...good, min: 'm'.repeat(65) })).toBeNull()
    expect(parsePickerOpen({ ...good, step: 5 })).toBeNull()
    expect(parsePickerOpen({ ...good, max: undefined })).toBeNull()
  })
  it('copies only the known fields', () => {
    const r = parsePickerOpen({ ...good, extra: true }) as Record<string, unknown>
    expect(r).not.toHaveProperty('extra')
  })
})

describe('parsePickerRequest', () => {
  const { rect, ...rest } = good
  const req = { ...rest, tabId: 'tab-1', anchor: rect }
  it('is a PickerOpen on a tab, anchored in window coordinates', () => {
    expect(parsePickerRequest(req)).toEqual({ ...rest, tabId: 'tab-1', anchor: { x: 10, y: 21, width: 160, height: 24 } })
  })
  it('refuses a missing tab and a bad anchor', () => {
    expect(parsePickerRequest({ ...req, tabId: '' })).toBeNull()
    expect(parsePickerRequest({ ...rest, anchor: rect })).toBeNull()
    expect(parsePickerRequest({ ...req, anchor: null })).toBeNull()
  })
})

describe('parsePickerEvent', () => {
  it('accepts a bounded value with a commit flag', () => {
    expect(parsePickerEvent({ value: '#ff0000', done: false })).toEqual({ value: '#ff0000', done: false })
    expect(parsePickerEvent({ value: '', done: true })).toEqual({ value: '', done: true })
  })
  it('refuses a missing flag, a non-string or overlong value', () => {
    expect(parsePickerEvent({ value: '#ff0000' })).toBeNull()
    expect(parsePickerEvent({ value: null, done: true })).toBeNull()
    expect(parsePickerEvent({ value: 'v'.repeat(65), done: true })).toBeNull()
    expect(parsePickerEvent('x')).toBeNull()
  })
})
