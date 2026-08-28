import { describe, expect, it } from 'vitest'
import { closeTab, tabTitle, canAddTab } from '../../src/shared/tabList'

const list = (...ids: string[]) => ids.map(id => ({ id }))

describe('closeTab', () => {
  it('activates the tab to the right when closing the active one', () => {
    const r = closeTab(list('a', 'b', 'c'), 'b', 'b')
    expect(r.tabs.map(t => t.id)).toEqual(['a', 'c'])
    expect(r.activeId).toBe('c')
  })

  it('activates the tab to the left when closing the last one', () => {
    const r = closeTab(list('a', 'b', 'c'), 'c', 'c')
    expect(r.activeId).toBe('b')
  })

  it('leaves the active tab alone when closing a different one', () => {
    const r = closeTab(list('a', 'b', 'c'), 'a', 'c')
    expect(r.activeId).toBe('c')
  })

  it('reports empty when the only tab closes, so the caller opens a blank one', () => {
    const r = closeTab(list('a'), 'a', 'a')
    expect(r.tabs).toEqual([])
    expect(r.activeId).toBeNull()
  })
})

describe('canAddTab', () => {
  it('allows up to the cap and refuses past it', () => {
    expect(canAddTab(11, 12)).toBe(true)
    expect(canAddTab(12, 12)).toBe(false)
  })
})

describe('tabTitle', () => {
  it('prefers the page title', () => {
    expect(tabTitle('https://usekolo.app/pricing', 'Kolo — Pricing')).toBe('Kolo — Pricing')
  })

  it('falls back to the host when there is no title', () => {
    expect(tabTitle('https://usekolo.app/pricing', '')).toBe('usekolo.app')
  })

  it('keeps the port, which is what distinguishes local servers', () => {
    expect(tabTitle('http://localhost:4173/', '')).toBe('localhost:4173')
  })

  it('calls an unused tab a new tab, however its blankness is spelled', () => {
    expect(tabTitle('', '')).toBe('New tab')
    // Every session starts here and an unused tab never leaves; `about:blank`
    // has no host, so without this it would be labelled with its own scheme.
    expect(tabTitle('about:blank', '')).toBe('New tab')
  })

  it('still prefers a page title over the blank fallback', () => {
    expect(tabTitle('about:blank', 'Untitled')).toBe('Untitled')
  })

  it('falls back to the raw string when it is not a URL', () => {
    expect(tabTitle('not a url', '')).toBe('not a url')
  })

  it('names a blank tab', () => {
    expect(tabTitle('', '')).toBe('New tab')
  })
})
