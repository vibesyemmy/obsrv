import { describe, expect, it } from 'vitest'
import { parseMenuRequest, parseSelectOpen, parseSelectResult } from '../../src/shared/ipcPayloads'

const groups = [{ label: 'Fruit', options: [{ value: '0', label: 'Apple' }, { value: '1', label: 'Pear' }] }, { options: [{ value: '2', label: 'Other' }] }]

describe('parseSelectOpen', () => {
  const good = { id: 3, rect: { x: 10.4, y: 20.6, width: 120, height: 24 }, selectedIndex: 1, ariaLabel: 'Fruit', groups }
  it('accepts a request and rounds the rect like any pane rect', () => {
    expect(parseSelectOpen(good)).toEqual({ ...good, rect: { x: 10, y: 21, width: 120, height: 24 } })
  })
  it('allows nothing selected (-1) and refuses anything below it', () => {
    expect(parseSelectOpen({ ...good, selectedIndex: -1 })?.selectedIndex).toBe(-1)
    expect(parseSelectOpen({ ...good, selectedIndex: -2 })).toBeNull()
    expect(parseSelectOpen({ ...good, selectedIndex: 1.5 })).toBeNull()
  })
  it('refuses a bad id, a bad rect, an overlong label, and an empty menu', () => {
    expect(parseSelectOpen({ ...good, id: 0 })).toBeNull()
    expect(parseSelectOpen({ ...good, id: '3' })).toBeNull()
    expect(parseSelectOpen({ ...good, rect: { x: 0, y: 0, width: -1, height: 24 } })).toBeNull()
    expect(parseSelectOpen({ ...good, ariaLabel: 'x'.repeat(121) })).toBeNull()
    expect(parseSelectOpen({ ...good, groups: [{ options: [] }] })).toBeNull()
    expect(parseSelectOpen({ ...good, groups: 'rows' })).toBeNull()
    expect(parseSelectOpen(null)).toBeNull()
  })
  it('copies only the known option fields', () => {
    const r = parseSelectOpen({ ...good, groups: [{ options: [{ value: '0', label: 'A', extra: 1 }] }] })
    expect(r?.groups).toEqual([{ options: [{ value: '0', label: 'A' }] }])
  })
})

describe('menus hold a thousand rows', () => {
  const rows = (n: number) => [{ options: Array.from({ length: n }, (_, i) => ({ value: String(i), label: `Row ${i}` })) }]
  it('a country list fits; one past the cap does not', () => {
    expect(parseSelectOpen({ id: 1, rect: { x: 0, y: 0, width: 1, height: 1 }, selectedIndex: 0, ariaLabel: 'c', groups: rows(1000) })).not.toBeNull()
    expect(parseSelectOpen({ id: 1, rect: { x: 0, y: 0, width: 1, height: 1 }, selectedIndex: 0, ariaLabel: 'c', groups: rows(1001) })).toBeNull()
    expect(parseMenuRequest({ groups: rows(1000), value: '0', ariaLabel: 'c', anchor: { x: 0, y: 0, width: 1, height: 1 } })).not.toBeNull()
    expect(parseMenuRequest({ groups: rows(1001), value: '0', ariaLabel: 'c', anchor: { x: 0, y: 0, width: 1, height: 1 } })).toBeNull()
  })
})

describe('parseSelectResult', () => {
  it('accepts a row or a dismissal', () => {
    expect(parseSelectResult({ tabId: 'tab-1', id: 3, index: 2 })).toEqual({ tabId: 'tab-1', id: 3, index: 2 })
    expect(parseSelectResult({ tabId: 'tab-1', id: 3, index: null })).toEqual({ tabId: 'tab-1', id: 3, index: null })
  })
  it('refuses a missing tab, a bad id, a negative or fractional row', () => {
    expect(parseSelectResult({ id: 3, index: 2 })).toBeNull()
    expect(parseSelectResult({ tabId: '', id: 3, index: 2 })).toBeNull()
    expect(parseSelectResult({ tabId: 'tab-1', id: 0, index: 2 })).toBeNull()
    expect(parseSelectResult({ tabId: 'tab-1', id: 3, index: -1 })).toBeNull()
    expect(parseSelectResult({ tabId: 'tab-1', id: 3, index: 1.5 })).toBeNull()
    expect(parseSelectResult({ tabId: 'tab-1', id: 3 })).toBeNull()
  })
})
