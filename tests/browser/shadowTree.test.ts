import { afterEach, describe, expect, it } from 'vitest'
import { auditPage } from '../../src/shared/audit'
import { inspectAtPoint, inspectTarget } from '../../src/shared/inspect'
import { STUCK_CHROME_SCRIPT } from '../../src/shared/stuckChrome'
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

/**
 * `installStuckChrome` carries its OWN ancestor walk, `holdsAnchor`, because it
 * ships as source and a call to the shared `shadowContains` would be namespaced
 * by the bundler — which is exactly what `#293` shipped and four
 * `cli-snap-tiled` tests caught on CI. The duplication is deliberate and
 * documented at both ends.
 *
 * **What was missing is anything checking they agree**
 * (`chore-page-script-guard-holes`, item 3). Wren read them line by line and
 * they matched; the risk was never today's text, it is an edit to one and not
 * the other, and a comment saying "same rule as" is not a check.
 *
 * It is taken from `STUCK_CHROME_SCRIPT` rather than imported, because
 * `holdsAnchor` is a local inside `installStuckChrome` and **the shipped string
 * is the thing that has to be right**. If someone edits the function, the
 * string changes and this arm compares the new one.
 */
describe('holdsAnchor and shadowContains answer the same', () => {
  const source = /const holdsAnchor = (\([\s\S]*?\n  \})/.exec(STUCK_CHROME_SCRIPT)?.[1]
  const holdsAnchor = source ? (new Function(`return ${source}`)() as (outer: Element, inner: Element) => boolean) : null

  it('was actually extracted from the shipped script', () => {
    // Without this the pairs below would run against `null`, skip silently and
    // report a pass — a check that cannot fail is the thing this card is about.
    expect(source, `holdsAnchor not found in STUCK_CHROME_SCRIPT`).toBeTruthy()
    expect(typeof holdsAnchor).toBe('function')
  })

  it('agrees for every pair across slots, hosts and plain parents', () => {
    const page = mount('')
    const { el, root } = component(page, '<div class="frame"><slot></slot></div>')
    el.innerHTML = '<span id="slotted">slotted</span>'
    const inner = component(root.querySelector('.frame')!, '<b class="deep">deep</b>')

    const nodes: Element[] = [
      page,
      el,
      root.querySelector('.frame')!,
      root.querySelector('slot')!,
      el.querySelector('#slotted')!,
      inner.el,
      inner.root.querySelector('.deep')!,
      document.body,
    ]

    const disagreed: string[] = []
    for (const outer of nodes) {
      for (const inner2 of nodes) {
        const a = shadowContains(outer, inner2)
        const b = holdsAnchor!(outer, inner2)
        if (a !== b) disagreed.push(`${outer.tagName}.${outer.className || '-'} / ${inner2.tagName}.${inner2.className || '-'}: shared=${a} stuck=${b}`)
      }
    }
    expect(disagreed, disagreed.join('\n')).toEqual([])
  })

  it('agrees that a node in a CLOSED root is contained by nothing outside it', () => {
    // The one case where the two could plausibly differ: neither walks into a
    // closed root, and both should say no rather than throw.
    const page = mount('')
    const closed = component(page, '<i class="hidden-deep">x</i>', 'closed')
    const deep = closed.root.querySelector('.hidden-deep')!
    expect(shadowContains(page, deep)).toBe(holdsAnchor!(page, deep))
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
    // Chromium's `ShadowRoot.elementsFromPoint` keeps the outer scopes' own
    // elements rather than stopping at the root, which is why one query per
    // scope is enough (measured on #293, both here and by Wren).
    expect(stack).toContain(document.body)
    expect(stack).toContain(el)
    // In paint order: the card before the body under it.
    expect(stack!.indexOf(root.querySelector('.card')!)).toBeLessThan(stack!.indexOf(document.body))
    expect(el.isConnected).toBe(true)
  })

  it('reads text SLOTTED into a component against the card the component draws around it', () => {
    // The ordinary card: the component paints the surface inside its root and
    // the page writes the text into the slot. `document.elementsFromPoint`
    // retargets the surface to the host, so the text was judged on the page's
    // white — 1.24:1 where what is painted is 11.86:1 (Wren's measurement on
    // #293). Every scope the text is composed through is asked now.
    const page = mount('')
    const { el, root } = component(
      page,
      '<style>.surface { position: fixed; left: 0; top: 0; width: 240px; height: 80px; background: rgb(31, 41, 55); }</style>' +
        '<div class="surface"><slot></slot></div>',
    )
    el.innerHTML = '<p id="slotted" style="margin: 0; padding: 20px; color: rgb(229, 231, 235); font: 16px Arial, sans-serif">slotted</p>'
    const slotted = el.querySelector('#slotted')!

    const stack = shadowStackFrom(slotted, 40, 30)
    expect(stack, 'the text is not at the point').not.toBeNull()
    expect(stack![0]).toBe(slotted)
    expect(stack, JSON.stringify(stack?.map(e => e.tagName))).toContain(root.querySelector('.surface'))
    expect(stack!.indexOf(root.querySelector('.surface')!)).toBeLessThan(stack!.indexOf(document.body))

    const r = inspectAtPoint(40, 30)
    expect(r?.id).toBe('slotted')
    expect(r?.background).toEqual([31, 41, 55, 1])
  })

  it('reads text in a component slotted into another component against the outer card', () => {
    // Lit composition: <inner-row> is a light child of <outer-card>, so the
    // outer card's surface is in a scope neither the document nor the inner
    // root can see.
    const page = mount('')
    const outer = component(
      page,
      '<style>.outer { position: fixed; left: 0; top: 0; width: 240px; height: 80px; background: rgb(31, 41, 55); }</style>' +
        '<div class="outer"><slot></slot></div>',
    )
    const inner = component(outer.el, '<p id="deep" style="margin: 0; padding: 20px; color: rgb(229, 231, 235); font: 16px Arial, sans-serif">deep</p>')
    const deep = inner.root.querySelector('#deep')!

    const stack = shadowStackFrom(deep, 40, 30)
    expect(stack![0]).toBe(deep)
    expect(stack, JSON.stringify(stack?.map(e => e.tagName))).toContain(outer.root.querySelector('.outer'))
    expect(inspectAtPoint(40, 30)?.background).toEqual([31, 41, 55, 1])
  })

  it('keeps the stack for an element whose centre is covered, over a backdrop in another branch', () => {
    // The fix for slotted text asked "is this element the topmost thing at the
    // point", which a container with a block child never is. That sent it to
    // the ancestor walk, which cannot see a scrim from another branch — the
    // lemonde.fr case (Wren's second read of #293). Any index counts.
    const page = mount(
      '<div id="backdrop" style="position: fixed; left: 0; top: 0; width: 240px; height: 80px; background: rgb(31, 41, 55)"></div>' +
        '<div id="covered" style="position: fixed; left: 0; top: 0; width: 240px; height: 80px; color: rgb(229, 231, 235); font: 16px Arial, sans-serif">' +
        '<div style="height: 80px">a block child over its parent\'s centre</div></div>',
    )
    const covered = page.querySelector('#covered')!
    expect(document.elementsFromPoint(40, 30).indexOf(covered), 'the parent should be under its child at that point').toBeGreaterThan(0)
    expect(shadowStackFrom(covered, 40, 30), 'the covered element lost its stack').not.toBeNull()
    const r = inspectTarget('selector', '#covered') as { background: number[] } | null
    expect(r?.background).toEqual([31, 41, 55, 1])
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
