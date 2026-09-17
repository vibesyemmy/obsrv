import { afterEach, describe, expect, it } from 'vitest'
import { auditPage } from '../../src/shared/audit'
import { inspectAtPoint } from '../../src/shared/inspect'
import {
  SHADOW_TREE_SCRIPT,
  shadowContains,
  shadowElementFromPoint,
  shadowElements,
  shadowParent,
  shadowStackFrom,
} from '../../src/shared/scrollHost'

/**
 * The measurement crosses open shadow boundaries (`feat-measure-open-shadow-roots`).
 *
 * chromestatus.com/features (2026-09-12) held 159 open roots with 136
 * interactive elements, and the audit answered 0 targets and 0 text, because
 * `querySelectorAll`, a TreeWalker, `parentElement` and
 * `document.elementFromPoint` all stop at a shadow boundary. These are the
 * helpers that cross it. They need real shadow roots and real layout, so they
 * are tested in a browser.
 */

let host: HTMLDivElement | null = null

function mount(html: string): HTMLDivElement {
  host = document.createElement('div')
  host.innerHTML = html
  document.body.append(host)
  return host
}

afterEach(() => {
  host?.remove()
  host = null
})

/** An element with an open (or closed) root holding `inner`, appended to `into`. */
function component(into: Element, inner: string, mode: 'open' | 'closed' = 'open'): { el: HTMLElement; root: ShadowRoot } {
  const el = document.createElement('div')
  const root = el.attachShadow({ mode })
  root.innerHTML = inner
  into.append(el)
  return { el, root }
}

describe('shadowElements', () => {
  it('visits the light DOM and every open root once, and never a closed one', () => {
    const page = mount('<button id="light">light</button>')
    component(page, '<button id="in-open">open</button>')
    const closed = component(page, '<button id="in-closed">closed</button>', 'closed')

    const ids = shadowElements(page).map(e => e.id).filter(id => id.length > 0)
    expect(ids).toContain('light')
    expect(ids).toContain('in-open')
    expect(ids).not.toContain('in-closed')
    // Once each.
    expect(ids.filter(id => id === 'in-open')).toHaveLength(1)
    expect(closed.root.querySelector('#in-closed')).not.toBeNull()
  })

  it('enters a root inside a root', () => {
    const page = mount('')
    const outer = component(page, '<section id="outer-content"></section>')
    component(outer.root.querySelector('section')!, '<a id="deep" href="#d">deep</a>')
    expect(shadowElements(page).map(e => e.id)).toContain('deep')
  })

  it('counts a slotted child once, where it sits in the light DOM', () => {
    const page = mount('')
    const { el } = component(page, '<div class="frame"><slot></slot></div>')
    el.innerHTML = '<span id="slotted">slotted</span>'
    expect(shadowElements(page).filter(e => e.id === 'slotted')).toHaveLength(1)
  })

  it('serialises, so the page-side scripts can carry it', () => {
    const page = mount('')
    component(page, '<i id="from-source">x</i>')
    // eslint-disable-next-line no-new-func
    const fromSource = new Function(`${SHADOW_TREE_SCRIPT}\nreturn shadowElements`)() as typeof shadowElements
    expect(fromSource(page).map(e => e.id)).toContain('from-source')
  })
})

describe('shadowParent and shadowContains', () => {
  it('climbs a slotted child to its slot, the top of a root to its host, and anything else to its parent', () => {
    const page = mount('')
    const { el, root } = component(page, '<div class="frame"><slot></slot></div>')
    el.innerHTML = '<span id="slotted">slotted</span>'
    const slotted = el.querySelector('#slotted')!
    const slot = root.querySelector('slot')!
    const frame = root.querySelector('.frame')!

    expect(shadowParent(slotted)).toBe(slot)
    expect(shadowParent(slot)).toBe(frame)
    expect(shadowParent(frame)).toBe(el)
    expect(shadowParent(el)).toBe(page)
    expect(shadowContains(frame, slotted)).toBe(true)
    expect(shadowContains(slotted, frame)).toBe(false)
  })
})

describe('at a point inside a component', () => {
  const CARD =
    '<style>.card { position: fixed; left: 0; top: 0; width: 240px; height: 80px; background: rgb(31, 41, 55); }' +
    ' p { margin: 0; padding: 20px; color: rgb(229, 231, 235); font: 16px Arial, sans-serif; }</style>' +
    '<div class="card"><p id="inner">inside the card</p></div>'

  it('names the element drawn there, not the host', () => {
    const page = mount('')
    component(page, CARD)
    expect(document.elementFromPoint(40, 30)?.id).not.toBe('inner')
    expect(shadowElementFromPoint(40, 30)?.id).toBe('inner')
  })

  it("stacks the component's own layers above the page's", () => {
    const page = mount('')
    const { el, root } = component(page, CARD)
    const inner = root.querySelector('#inner')!
    const stack = shadowStackFrom(inner, 40, 30)
    expect(stack).not.toBeNull()
    expect(stack![0]).toBe(inner)
    expect(stack).toContain(root.querySelector('.card'))
    expect(stack).toContain(document.body)
    // In paint order: the card before the body under it.
    expect(stack!.indexOf(root.querySelector('.card')!)).toBeLessThan(stack!.indexOf(document.body))
    expect(el.isConnected).toBe(true)
  })

  it('inspect reads the text against the card, not the page', () => {
    const page = mount('')
    component(page, CARD)
    const r = inspectAtPoint(40, 30)
    expect(r?.id).toBe('inner')
    expect(r?.background).toEqual([31, 41, 55, 1])
  })
})

describe('the audit, over a component', () => {
  it('measures the controls inside an open root, and none inside a closed one', () => {
    const page = mount('<button style="width:60px;height:60px">light</button>')
    component(page, '<button style="width:60px;height:60px">open one</button><button style="width:60px;height:60px">open two</button>')
    component(page, '<button style="width:60px;height:60px">closed</button>', 'closed')
    const texts = auditPage(2000, 3000).targets.map(t => t.text)
    expect(texts).toEqual(expect.arrayContaining(['light', 'open one', 'open two']))
    expect(texts).not.toContain('closed')
  })
})
