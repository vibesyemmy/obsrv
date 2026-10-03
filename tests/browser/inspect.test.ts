import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { INSPECT_SCRIPT, inspectAtPoint, inspectTarget, MAX_LINE_RECTS } from '../../src/shared/inspect'
import type { InspectReport } from '../../src/shared/inspect'
import { findScroller, rootScrolls } from '../../src/shared/scrollHost'

/**
 * `inspectAtPoint` runs inside the target page, so it is tested against a
 * real DOM with real layout. It is also shipped as *source* and evaluated
 * there, which is why the last test runs the stringified form: a helper the
 * bundler hoisted out of the function would pass every other test here and
 * throw in the target.
 */

let host: HTMLDivElement

beforeEach(() => {
  host = document.createElement('div')
  host.innerHTML = `
    <style>
      #host, #host * { margin: 0; font-family: Arial, sans-serif; }
      #host { position: fixed; left: 0; top: 0; width: 400px; height: 400px; background: #fff; }
      #grey { position: absolute; left: 10px; top: 10px; width: 300px; font-size: 13px; color: rgb(107, 114, 128); }
      #card { position: absolute; left: 10px; top: 60px; width: 300px; height: 80px; background: rgb(17, 17, 17); }
      #card p { padding: 20px; font-size: 16px; font-weight: 700; color: rgb(204, 204, 204); }
      #veil { position: absolute; left: 10px; top: 160px; width: 300px; height: 40px; background: rgba(0, 0, 0, 0.5); }
      #veil span { font-size: 12px; color: rgb(255, 255, 255); }
      #photo { position: absolute; left: 10px; top: 220px; width: 300px; height: 40px; background: linear-gradient(90deg, #000, #fff); }
      #photo span { font-size: 12px; color: rgb(255, 0, 0); }
      /* lemonde.fr's consent wall: a dark scrim from another branch of the tree, the text a sibling above it. */
      #scrim { position: absolute; left: 10px; top: 280px; width: 300px; height: 40px; background: rgb(41, 42, 43); z-index: 1; }
      #scrim-text { position: absolute; left: 20px; top: 290px; font-size: 14px; color: rgb(239, 240, 243); z-index: 2; }
      /* not drawn at all: the rule is on the ancestor, which is the case a
         one-element check misses */
      #gone { display: none; }
      #veiled { visibility: hidden; }
      /* a photo as an <img>, not a background, with a caption over it */
      #pic { position: absolute; left: 10px; top: 340px; width: 300px; height: 40px; }
      #pic-text { position: absolute; left: 20px; top: 350px; font-size: 12px; color: rgb(255, 255, 255); z-index: 2; }
    </style>
    <p id="grey">Grey caption text on white</p>
    <div id="card"><p id="card-text">Light text on a dark card</p></div>
    <div id="veil"><span id="veil-text">White on a half-black veil</span></div>
    <div id="photo"><span id="photo-text">Red on a gradient</span></div>
    <div id="scrim"></div><span id="scrim-text">Reject all cookies</span>
    <div id="gone"><p id="gone-text">Never drawn: display none on its parent</p></div>
    <div id="veiled"><p id="veiled-text">Never drawn: visibility hidden on its parent</p></div>
    <img id="pic" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=" alt=""><span id="pic-text">Caption over a photo</span>
    <input id="plain-text" type="text" />
    <input id="no-type-attr" />
    <input id="password-field" type="password" />
    <input id="email-field" type="email" />
    <input id="checkbox-field" type="checkbox" />
    <input id="disabled-field" type="text" disabled />
    <input id="readonly-field" type="text" readonly />
    <textarea id="a-textarea"></textarea>
    <div id="editable-host" contenteditable="true"><p id="editable-child">nested</p></div>
    <div id="not-editable"><p id="not-editable-child">nested, but the host is not editable</p></div>
    <p id="plain-paragraph">Not a form field at all</p>
    <p id="wrap-two" style="position: absolute; left: 10px; top: 420px; width: 150px; line-height: 2.2; font-size: 14px;"><a id="wrapped-two" href="#">A product title long enough to wrap</a></p>
    <p id="wrap-three" style="position: absolute; left: 200px; top: 420px; width: 90px; line-height: 2.2; font-size: 14px;"><a id="wrapped-three" href="#">A product title long enough to wrap onto three lines</a></p>
  `
  host.id = 'host'
  document.body.append(host)
})
afterEach(() => host.remove())

const centre = (id: string): { x: number; y: number } => {
  const r = document.getElementById(id)!.getBoundingClientRect()
  return { x: r.left + Math.min(20, r.width / 2), y: r.top + r.height / 2 }
}

describe('inspectAtPoint', () => {
  it('reads the element, its font and its colour on the page white', () => {
    const { x, y } = centre('grey')
    const r = inspectAtPoint(x, y)!
    expect(r.tag).toBe('p')
    expect(r.id).toBe('grey')
    expect(r.text).toBe('Grey caption text on white')
    expect(r.fontSizePx).toBe(13)
    expect(r.fontWeight).toBe(400)
    expect(r.fontFamily).toBe('Arial')
    expect(r.color).toEqual([107, 114, 128, 1])
    expect(r.background).toEqual([255, 255, 255, 1])
    expect(r.backgroundNote).toBe('computed')
    expect(r.rect.width).toBeCloseTo(300, 0)
  })
  it('walks up to the first opaque background', () => {
    const { x, y } = centre('card-text')
    const r = inspectAtPoint(x, y)!
    expect(r.id).toBe('card-text')
    expect(r.fontWeight).toBe(700)
    expect(r.color).toEqual([204, 204, 204, 1])
    expect(r.background).toEqual([17, 17, 17, 1])
  })
  it('takes the background painted under the text, not only what its ancestors paint: a scrim from another branch', () => {
    // A walk up the ancestors met only the host's white and failed this pair at 1.14:1.
    const { x, y } = centre('scrim-text')
    const r = inspectAtPoint(x, y)!
    expect(r.id).toBe('scrim-text')
    expect(r.color).toEqual([239, 240, 243, 1])
    expect(r.background).toEqual([41, 42, 43, 1])
    expect(r.backgroundNote).toBe('computed')
  })
  it('an image element painted under the text is a stop, like a background image', () => {
    const { x, y } = centre('pic-text')
    const r = inspectAtPoint(x, y)!
    expect(r.id).toBe('pic-text')
    expect(r.background).toBeNull()
    expect(r.backgroundNote).toBe('image')
  })
  it('composites a translucent layer onto what is under it', () => {
    const { x, y } = centre('veil-text')
    const r = inspectAtPoint(x, y)!
    expect(r.id).toBe('veil-text')
    expect(r.background!.slice(0, 3).map(Math.round)).toEqual([128, 128, 128])
  })
  it('refuses to guess under an image or gradient', () => {
    const { x, y } = centre('photo-text')
    const r = inspectAtPoint(x, y)!
    expect(r.id).toBe('photo-text')
    expect(r.background).toBeNull()
    expect(r.backgroundNote).toBe('image')
  })
  it('is null off the document', () => {
    expect(inspectAtPoint(-10, -10)).toBeNull()
  })
  it('works as the shipped source, which must be self-contained: by point and by selector', () => {
    // eslint-disable-next-line no-new-func
    const fromSource = new Function(`return ${INSPECT_SCRIPT}`)() as typeof inspectTarget
    const { x, y } = centre('card-text')
    expect(fromSource('point', x, y)).toEqual(inspectAtPoint(x, y))
    expect(fromSource('selector', '#card-text')).toEqual(inspectAtPoint(x, y))
    // Nothing matched: null. Not a selector at all: the marker, never a throw
    // — it has to survive `executeJavaScriptInIsolatedWorld`, which a throw
    // does not.
    expect(fromSource('selector', '#no-such-element')).toBeNull()
    expect(fromSource('selector', '[[[')).toEqual({ invalidSelector: true })
  })
})

describe('a selector the browser will not accept', () => {
  it('is told apart from one that matches nothing', () => {
    // The two answered identically before this, down to the human line, so a
    // typo read as "that element is not on the page".
    expect(inspectTarget('selector', '#no-such-thing')).toBeNull()
    expect(inspectTarget('selector', 'p[')).toEqual({ invalidSelector: true })
  })
  it('rejects only what this engine rejects: the note names these cases, so they are measured', () => {
    // `:has()` and `:is()` are CSS this Chromium accepts; `:contains()` is
    // jQuery's and never was. The note in inspectReadout.ts tells agents
    // exactly this, and a note that is wrong about the engine is worse than
    // no note, so it is checked against the engine rather than believed.
    expect(inspectTarget('selector', '#card:has(> p)')).not.toBeNull()
    expect(inspectTarget('selector', ':is(#grey)')).not.toBeNull()
    expect(inspectTarget('selector', 'p:contains("Grey")')).toEqual({ invalidSelector: true })
  })
})

describe('an element that is not drawn', () => {
  const report = (sel: string): InspectReport => inspectTarget('selector', sel) as InspectReport
  it("names display: none on an ancestor, not on the element", () => {
    const r = report('#gone-text')
    expect(r.id).toBe('gone-text')
    expect(r.hidden).toBe('display')
  })
  it('names visibility: hidden on an ancestor', () => {
    expect(report('#veiled-text').hidden).toBe('visibility')
  })
  it('is null for an element the screen shows, which is the ordinary case', () => {
    expect(report('#grey').hidden).toBeNull()
    const { x, y } = centre('card-text')
    expect(inspectAtPoint(x, y)!.hidden).toBeNull()
  })
})

describe('editability, for a type step’s decisions', () => {
  const report = (sel: string): InspectReport => inspectTarget('selector', sel) as InspectReport

  it('a plain text input is editable, inputType "text", not disabled or readOnly', () => {
    const r = report('#plain-text')
    expect(r.editable).toBe(true)
    expect(r.inputType).toBe('text')
    expect(r.disabled).toBe(false)
    expect(r.readOnly).toBe(false)
  })

  it('an input with no type attribute defaults to "text", per the HTML spec, not to null', () => {
    const r = report('#no-type-attr')
    expect(r.editable).toBe(true)
    expect(r.inputType).toBe('text')
  })

  it('a password field is editable and its inputType is exactly "password" — the one fact masking keys on', () => {
    const r = report('#password-field')
    expect(r.editable).toBe(true)
    expect(r.inputType).toBe('password')
  })

  it('other text-accepting input types (email) are editable with their own inputType, not folded into "text"', () => {
    expect(report('#email-field').inputType).toBe('email')
  })

  it('a checkbox is not editable — it takes no typed text regardless of disabled/readOnly', () => {
    const r = report('#checkbox-field')
    expect(r.editable).toBe(false)
    expect(r.inputType).toBe('checkbox')
  })

  it('a disabled input is still editable=true (it CAN take text in principle) with disabled=true — type refuses on disabled, not on editable', () => {
    const r = report('#disabled-field')
    expect(r.editable).toBe(true)
    expect(r.disabled).toBe(true)
    expect(r.readOnly).toBe(false)
  })

  it('a readonly input reads readOnly=true, disabled=false', () => {
    const r = report('#readonly-field')
    expect(r.readOnly).toBe(true)
    expect(r.disabled).toBe(false)
  })

  it('a textarea is editable with inputType null — a textarea has no type attribute to read', () => {
    const r = report('#a-textarea')
    expect(r.editable).toBe(true)
    expect(r.inputType).toBeNull()
  })

  it('a contenteditable host is editable, inputType null (not an <input>)', () => {
    const r = report('#editable-host')
    expect(r.editable).toBe(true)
    expect(r.inputType).toBeNull()
  })

  it('a plain element inside a contenteditable ancestor inherits editability — the click a QA flow resolves may land on the child, not the host', () => {
    expect(report('#editable-child').editable).toBe(true)
  })

  it('a plain element inside a NON-editable ancestor is not editable', () => {
    expect(report('#not-editable-child').editable).toBe(false)
  })

  it('an ordinary paragraph is not editable, inputType null, not disabled or readOnly', () => {
    const r = report('#plain-paragraph')
    expect(r.editable).toBe(false)
    expect(r.inputType).toBeNull()
    expect(r.disabled).toBe(false)
    expect(r.readOnly).toBe(false)
  })
})

describe('lineRects, the element’s own boxes a click by selector aims at', () => {
  const report = (selector: string): InspectReport => inspectTarget('selector', selector) as InspectReport
  const bottom = (q: { y: number; height: number }): number => q.y + q.height

  it('is the border box itself for a block: one box, equal to rect', () => {
    const r = report('#card')
    expect(r.lineRects).toHaveLength(1)
    expect(r.lineRects[0]).toEqual(r.rect)
  })

  it('is one box per line for a wrapped inline, and not the leading between them', () => {
    const r = report('#wrapped-two')
    expect(r.lineRects).toHaveLength(2)
    const [first, second] = r.lineRects as [InspectReport['lineRects'][number], InspectReport['lineRects'][number]]
    // The premise of the whole field: `rect` is the union, so it holds a gap the link does not paint.
    expect(second.y - bottom(first), 'no leading between the lines, so this fixture proves nothing').toBeGreaterThan(1)
    expect(r.rect.height).toBeGreaterThan(first.height + second.height)
    // The union's own centre is exactly the point the link does not paint: it is in no line box.
    const centreY = r.rect.y + r.rect.height / 2
    expect(r.lineRects.some(q => centreY >= q.y && centreY < bottom(q))).toBe(false)
    // Every line box is inside the union, and none is empty.
    for (const q of r.lineRects) {
      expect(q.width).toBeGreaterThan(0)
      expect(q.height).toBeGreaterThan(0)
      expect(q.y).toBeGreaterThanOrEqual(r.rect.y - 0.01)
      expect(bottom(q)).toBeLessThanOrEqual(bottom(r.rect) + 0.01)
    }
  })

  it('reports a wrap of three or more lines, which the five fixed fractions could not promise to reach', () => {
    const r = report('#wrapped-three')
    expect(r.lineRects.length).toBeGreaterThanOrEqual(3)
    const ys = r.lineRects.map(q => q.y)
    expect(ys).toEqual([...ys].sort((a, b) => a - b))
    expect(new Set(ys).size).toBe(ys.length)
  })

  it('is empty for an element that is not drawn, agreeing with its empty rect', () => {
    const r = report('#gone-text')
    expect(r.lineRects).toEqual([])
    expect(r.rect.width * r.rect.height).toBe(0)
  })

  it('drops a box with no area, which is what the published sentence "boxes with no area dropped" promises', () => {
    const empty = document.createElement('span')
    empty.id = 'empty-inline'
    host.append(empty)
    // The premise: the browser does report a box for an empty inline, and it has no width.
    const raw = Array.from(empty.getClientRects())
    expect(raw.length, 'the browser reported no box for an empty inline, so this proves nothing').toBeGreaterThan(0)
    expect(raw.every(q => q.width * q.height === 0)).toBe(true)
    expect(report('#empty-inline').lineRects).toEqual([])
  })

  it('stops at 32 boxes, keeping the first ones in document order', () => {
    const many = document.createElement('div')
    many.id = 'many'
    many.style.cssText = 'position: absolute; left: 10px; top: 900px; width: 20px; font-size: 10px; line-height: 12px;'
    many.innerHTML = `<a id="forty-lines" href="#">${Array.from({ length: 60 }, (_, i) => `w${i}`).join(' ')}</a>`
    host.append(many)
    const r = report('#forty-lines')
    expect(r.lineRects).toHaveLength(32)
    expect(r.lineRects[0]!.y).toBeCloseTo(r.rect.y, 1)
    const ys = r.lineRects.map(q => q.y)
    expect(ys).toEqual([...ys].sort((a, b) => a - b))
  })

  it('is the same through the shipped source, whose bound of 32 is written out rather than imported', () => {
    // eslint-disable-next-line no-new-func
    const fromSource = new Function(`return ${INSPECT_SCRIPT}`)() as typeof inspectTarget
    const direct = report('#wrapped-two')
    expect((fromSource('selector', '#wrapped-two') as InspectReport).lineRects).toEqual(direct.lineRects)
    // Two empty lists are equal, so say what the shipped form found rather than only that it agrees.
    expect((fromSource('selector', '#wrapped-two') as InspectReport).lineRects).toHaveLength(2)
    expect(MAX_LINE_RECTS).toBe(32)
  })
})

/**
 * `scroll`: where the page is scrolled at the instant the box was measured
 * (`bug-recorded-scroll-lags-a-page-scroll`).
 *
 * `pageRect` was `rect` plus the app's RECORD of the scroll, and the record is fed by reports the preload defers for
 * up to 120 ms after any scroll the app applies. A page that scrolled itself inside that window was reported at its
 * old position (400 of 400 back-to-back reads). The scroll is now read by the same synchronous call that measures
 * the box, so the two cannot disagree. These tests are the sequence that used to fail: scroll, then read at once.
 */
describe('scroll, read in the same call as the box', () => {
  let tall: HTMLDivElement | null = null
  let shell: HTMLDivElement | null = null
  afterEach(() => {
    window.scrollTo(0, 0)
    tall?.remove()
    tall = null
    shell?.remove()
    shell = null
    document.documentElement.style.overflow = ''
    document.body.style.overflow = ''
  })
  const mountTall = (): void => {
    tall = document.createElement('div')
    tall.style.cssText = 'position:absolute;left:0;top:0;width:200px;height:4000px'
    tall.innerHTML = '<div id="t" style="position:absolute;left:30px;top:1500px;width:100px;height:40px">target</div>'
    document.body.append(tall)
  }
  const report = (selector: string): InspectReport => inspectTarget('selector', selector) as InspectReport

  it('is the window\'s scroll for an element on a page that scrolls at the root, and rect plus it is the page position', () => {
    mountTall()
    window.scrollTo(0, 700)
    const r = report('#t')
    expect(r.scroll).toEqual({ x: 0, y: 700 })
    expect(r.rect.y + r.scroll.y).toBeCloseTo(1500, 1)
  })

  it('ignores an inner scroller when the root itself scrolls: a page with a scrollable widget is scrolled by its window', () => {
    mountTall()
    // A scrollable widget (a code block, a chat panel) on a page the ROOT scrolls. The agent's `scroll` moves the root
    // here, so the widget's own offset must not be added.
    const widget = document.createElement('div')
    widget.id = 'widget'
    widget.style.cssText = 'position:absolute;left:300px;top:20px;width:150px;height:100px;overflow-y:auto'
    widget.innerHTML = '<div style="height:600px">widget content</div>'
    tall!.append(widget)
    widget.scrollTop = 50
    window.scrollTo(0, 700)
    expect(rootScrolls()).toBe(true)
    expect(report('#t').scroll).toEqual({ x: 0, y: 700 })
  })

  it('follows a page-level scroll made a moment ago: scroll, then read at once, which is the case a record lagged', () => {
    mountTall()
    window.scrollTo(0, 1500)
    expect(report('#t').scroll.y).toBe(1500)
    window.scrollTo(0, 0)
    // No wait, no event loop turn: the old source answered 1500 here for up to 120 ms.
    expect(report('#t').scroll.y).toBe(0)
    window.scrollTo(0, 300)
    expect(report('#t').scroll.y).toBe(300)
  })

  it('adds the scroll host\'s offset when the page scrolls an inner element (an app shell), for every element, as the record did', () => {
    shell = document.createElement('div')
    shell.innerHTML =
      '<div id="chrome" style="position:fixed;left:0;top:0;width:300px;height:40px;background:#123">fixed chrome</div>' +
      '<div id="scroller" style="position:fixed;left:0;top:40px;width:300px;height:200px;overflow-y:auto">' +
      Array.from({ length: 40 }, (_, i) => `<div id="row${i}" style="height:30px">row ${i}</div>`).join('') +
      '</div>'
    document.body.append(shell)
    ;(shell.querySelector('#scroller') as HTMLElement).scrollTop = 300
    // An app shell: the root has nothing to scroll and an inner element is the host. Asserted, not assumed, so
    // that a runner whose layout lets the root scroll fails here loudly instead of passing for the wrong reason.
    expect(rootScrolls()).toBe(false)
    expect(findScroller().el?.id).toBe('scroller')

    const inside = report('#row12')
    expect(inside.scroll).toEqual({ x: 0, y: 300 })
    // Row 12 sits at 12 * 30 = 360 in the host's content; the viewport rect plus the scroll is that.
    expect(inside.rect.y + inside.scroll.y).toBeCloseTo(40 + 360, 1)
    // The fixed chrome is outside the host and gets the same offset, as the record it replaces gave it: a page-space
    // highlight maps every element back through ONE scroll, so the pair round-trips. (An audit finding maps such an
    // element per element, which is an older inconsistency this does not touch.)
    expect(report('#chrome').scroll).toEqual({ x: 0, y: 300 })
  })

  it('is the same through the shipped source, which carries the scroll-host helpers it now calls', () => {
    mountTall()
    window.scrollTo(0, 900)
    // eslint-disable-next-line no-new-func
    const fromSource = new Function(`return ${INSPECT_SCRIPT}`)() as typeof inspectTarget
    expect((fromSource('selector', '#t') as InspectReport).scroll).toEqual({ x: 0, y: 900 })
    expect((fromSource('selector', '#t') as InspectReport).scroll).toEqual(report('#t').scroll)
  })
})
