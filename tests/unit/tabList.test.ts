import { describe, expect, it } from 'vitest'
import { closeTab, moveTab, tabTitle, canAddTab } from '../../src/shared/tabList'

const list = (...ids: string[]) => ids.map(id => ({ id }))
const ids = (tabs: { id: string }[]) => tabs.map(t => t.id)

describe('moveTab', () => {
  it('moves a tab to the right, closing the gap behind it', () => {
    expect(ids(moveTab(list('a', 'b', 'c', 'd'), 'a', 2))).toEqual(['b', 'c', 'a', 'd'])
  })

  it('moves a tab to the left', () => {
    expect(ids(moveTab(list('a', 'b', 'c', 'd'), 'd', 1))).toEqual(['a', 'd', 'b', 'c'])
  })

  it('dropping a tab where it already is changes nothing', () => {
    expect(ids(moveTab(list('a', 'b', 'c'), 'b', 1))).toEqual(['a', 'b', 'c'])
  })

  it('clamps a destination past either end rather than dropping the tab', () => {
    // A drag can end past the last tab; losing one because the pointer went
    // too far is the worst outcome available here.
    expect(ids(moveTab(list('a', 'b', 'c'), 'a', 99))).toEqual(['b', 'c', 'a'])
    expect(ids(moveTab(list('a', 'b', 'c'), 'c', -5))).toEqual(['c', 'a', 'b'])
  })

  it('leaves the list alone when the id is not in it', () => {
    expect(ids(moveTab(list('a', 'b'), 'zz', 0))).toEqual(['a', 'b'])
  })

  it('keeps every tab exactly once, whatever the move', () => {
    // The failure this guards is silent: a splice that inserts before removing
    // duplicates one tab and drops another, and the strip still looks like a
    // strip of tabs.
    for (const from of ['a', 'b', 'c', 'd']) {
      for (const to of [-1, 0, 1, 2, 3, 4]) {
        const moved = ids(moveTab(list('a', 'b', 'c', 'd'), from, to))
        expect([...moved].sort()).toEqual(['a', 'b', 'c', 'd'])
      }
    }
  })
})

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
