import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AUDIT_SCRIPT, auditPage } from '../../src/shared/audit'

/**
 * `auditPage` runs inside the target page and only means anything against
 * real layout, so it is tested in a real browser. It is shipped as source,
 * so the last test runs the stringified form.
 */

let host: HTMLDivElement

beforeEach(() => {
  host = document.createElement('div')
  host.id = 'host'
  host.innerHTML = `
    <style>
      #host, #host * { margin: 0; font-family: Arial, sans-serif; }
      #host { position: fixed; left: 0; top: 0; width: 600px; height: 600px; background: #fff; padding: 16px; box-sizing: border-box; }
      #big { display: block; width: 200px; height: 48px; font-size: 16px; }
      #tiny { display: block; width: 24px; height: 24px; padding: 0; font-size: 10px; }
      #cta { display: inline-block; padding: 4px 8px; font-size: 14px; }
      #link { font-size: 16px; }
      #body { font-size: 16px; }
      #caption { font-size: 10px; }
      #hidden { visibility: hidden; font-size: 4px; }
      #none { display: none; font-size: 4px; }
      #zero { font-size: 0; }
      #zero span { font-size: 16px; }
      #ghost { opacity: 0; width: 10px; height: 10px; }
      #skip { position: absolute; left: -9999px; }
      /* HN's upvote: an inline anchor with no text, around a 10×10 block icon. */
      #vote { font-size: 10px; }
      #arrow { display: block; width: 10px; height: 10px; background: #999; }
      /* The same control on a layout that makes the anchor block (HN's phone layout). */
      #vote-block { display: block; width: 24px; height: 24px; }
      #arrow-block { display: block; width: 10px; height: 10px; background: #999; }
      /* The visually-hidden pattern: present for screen readers, 1×1 and clipped for everyone else. */
      .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
    </style>
    <button id="big" type="button">A generous button</button>
    <button id="tiny" type="button" aria-label="Close">×</button>
    <a id="cta" href="#x">A link styled as a control</a>
    <p id="body">Body text with <a id="link" href="#top">an inline link</a> in it.</p>
    <p id="caption">A caption</p>
    <p id="hidden">Hidden by visibility</p>
    <p id="none">Hidden by display</p>
    <p id="zero"><span id="zero-child">Text in a zero-size wrapper</span></p>
    <button id="ghost" type="button">Ghost</button>
    <div role="button" id="aria" tabindex="0">An ARIA button</div>
    <input id="field" type="text" value="typed" />
    <input id="hid" type="hidden" value="secret" />
    <a id="skip" href="#main">Skip to content</a>
    <a id="vote" href="#vote"><div id="arrow" title="upvote"></div></a>
    <a id="vote-block" href="#vote-block"><div id="arrow-block" title="upvote block"></div></a>
    <label id="sr" class="sr-only" for="field">Screen-reader label</label>
    <input id="sr-check" class="sr-only" type="checkbox" />
  `
  document.body.append(host)
})
afterEach(() => host.remove())

describe('auditPage', () => {
  it('lists the targets a finger is meant to land on, and skips what is not rendered or is an inline link', () => {
    const r = auditPage(2000, 3000)
    const ids = r.targets.map(t => t.element)
    expect(ids).toEqual(expect.arrayContaining(['button#big', 'button#tiny', 'a#cta', 'div#aria', 'input#field']))
    expect(ids).not.toContain('a#link')
    expect(ids).not.toContain('button#ghost')
    expect(ids).not.toContain('input#hid')
    // Off the page, and the 1×1 clipped checkbox of the visually-hidden pattern.
    expect(ids).not.toContain('a#skip')
    expect(ids).not.toContain('input#sr-check')
    const tiny = r.targets.find(t => t.element === 'button#tiny')!
    expect(tiny.rect.width).toBe(24)
    expect(tiny.rect.height).toBe(24)
    expect(tiny.text).toBe('×')
    expect(r.targets.find(t => t.element === 'input#field')!.text).toBe('typed')
    // An inline anchor with no text of its own around a sized child is a
    // control drawn as an icon, not a link in running text: measured at the
    // icon's box, named by the icon's title.
    const vote = r.targets.find(t => t.element === 'a#vote')!
    expect(vote).toBeDefined()
    expect(vote.rect.width).toBe(10)
    expect(vote.rect.height).toBe(10)
    expect(vote.text).toBe('upvote')
    // A block anchor around the same icon is a target by the ordinary rule,
    // and gets the same name: the fallback is for any target with no text
    // of its own, not only the inline ones (live on HN's phone layout the
    // upvotes were named "").
    const block = r.targets.find(t => t.element === 'a#vote-block')!
    expect(block.rect.width).toBe(24)
    expect(block.text).toBe('upvote block')
  })
  it('lists elements with text of their own, at the font size the glyphs take', () => {
    const r = auditPage(2000, 3000)
    const by = Object.fromEntries(r.text.map(t => [t.element, t]))
    expect(by['p#caption']!.fontSizePx).toBe(10)
    expect(by['p#body']!.fontSizePx).toBe(16)
    expect(by['a#link']!.fontSizePx).toBe(16)
    expect(by['span#zero-child']!.fontSizePx).toBe(16)
    expect(by['p#zero']).toBeUndefined()
    expect(by['p#hidden']).toBeUndefined()
    expect(by['p#none']).toBeUndefined()
    expect(by['button#ghost']).toBeUndefined()
    expect(by['label#sr']).toBeUndefined()
    expect(by['a#skip']).toBeUndefined()
    expect(by['button#tiny']!.text).toBe('×')
  })
  it('rects are page coordinates', () => {
    const r = auditPage(2000, 3000)
    const big = r.targets.find(t => t.element === 'button#big')!
    const dom = document.getElementById('big')!.getBoundingClientRect()
    expect(big.rect.x).toBeCloseTo(dom.left + scrollX, 3)
    expect(big.rect.y).toBeCloseTo(dom.top + scrollY, 3)
    expect(r.viewport).toEqual({ width: innerWidth, height: innerHeight })
    expect(r.pageHeight).toBeGreaterThan(0)
  })
  it('caps the lists and counts the rest', () => {
    const r = auditPage(2, 1)
    expect(r.targets).toHaveLength(2)
    expect(r.text).toHaveLength(1)
    expect(r.truncated.targets).toBeGreaterThan(0)
    expect(r.truncated.text).toBeGreaterThan(0)
  })
  it('works as the shipped source, which must be self-contained', () => {
    // eslint-disable-next-line no-new-func
    const fromSource = new Function(`return ${AUDIT_SCRIPT}`)() as typeof auditPage
    expect(fromSource(2000, 3000)).toEqual(auditPage(2000, 3000))
  })
})

/**
 * A page the document scrolls, beside a panel that scrolls itself: the shape
 * that made 48 sidebar links look like they sat below a capture covering the
 * whole page. See `clipTest` in shared/scrollHost.ts.
 */
describe('a panel with its own scrollbar', () => {
  let page: HTMLDivElement

  beforeEach(() => {
    page = document.createElement('div')
    page.innerHTML = `
      <style>
        #panel { position: absolute; left: 0; top: 0; width: 200px; height: 120px; overflow-y: auto; }
        #panel a { display: block; height: 20px; font-size: 11px; }
        #tall { margin-left: 220px; height: 3000px; }
        #in-page { display: block; width: 24px; height: 24px; padding: 0; font-size: 10px; }
      </style>
      <nav id="panel">${Array.from({ length: 250 }, (_, i) => `<a id="p${i}" href="#i${i}">Item ${i}</a>`).join('')}</nav>
      <div id="tall"><button id="in-page" type="button">x</button></div>
    `
    document.body.append(page)
  })
  afterEach(() => page.remove())

  const byId = (r: ReturnType<typeof auditPage>, id: string) => r.targets.find(t => t.element.startsWith(`a#${id}`) || t.element.startsWith(`button#${id}`))

  it('marks what the panel holds out of view, and leaves what it shows alone', () => {
    const r = auditPage(2000, 3000)
    // Six 20px rows fit the 120px panel; the rest are outside its box.
    expect(byId(r, 'p0')?.rect.clipped).toBeUndefined()
    expect(byId(r, 'p249')?.rect.clipped).toBe(true)
    expect(r.targets.filter(t => t.rect.clipped).length).toBeGreaterThan(20)
  })

  it('leaves the page\'s own elements unclipped, however far down they sit', () => {
    const r = auditPage(2000, 3000)
    expect(byId(r, 'in-page')?.rect.clipped).toBeUndefined()
  })

  it('keeps pageHeight to the page, not to how far the panel\'s content runs', () => {
    const r = auditPage(2000, 3000)
    const deepest = Math.max(...r.targets.filter(t => t.rect.clipped).map(t => t.rect.y + t.rect.height))
    // The panel's 250 links run 5,000 px, well past a 3,000 px document.
    expect(deepest).toBeGreaterThan(4000)
    expect(r.pageHeight).toBeLessThan(deepest)
    expect(r.pageHeight).toBeGreaterThanOrEqual(3000)
  })
})

/**
 * An app shell: the document cannot scroll, an inner container does. Page
 * coordinates used to add `window.scrollY` — 0 here however far the inner
 * scroller has gone — so once it was scrolled down, everything above the fold
 * had a negative top and was dropped as parked off the page, and pageHeight
 * collapsed to the viewport. Measured on usekolo.app at the bottom: 11
 * targets and pageHeight 768 on a 7,445 px page.
 */
describe('an app shell whose inner scroller has been scrolled', () => {
  let shell: HTMLDivElement
  let scroller: HTMLElement

  beforeEach(() => {
    shell = document.createElement('div')
    shell.innerHTML = `
      <style>
        #shell { position: fixed; inset: 0; overflow: hidden; background: #fff; }
        #chrome { position: absolute; left: 0; top: 0; right: 0; height: 48px; }
        #scroller { position: absolute; left: 0; top: 48px; right: 0; bottom: 0; overflow-y: auto; }
        #scroller .row { height: 120px; }
        #scroller p { margin: 0; font-size: 16px; }
        #deep { display: block; width: 24px; height: 24px; padding: 0; font-size: 10px; }
      </style>
      <div id="shell">
        <header id="chrome"><button id="menu" type="button">Menu</button></header>
        <main id="scroller">
          ${Array.from({ length: 20 }, (_, i) => `<div class="row"><p id="row${i + 1}">Row ${i + 1}</p></div>`).join('')}
          <div class="row"><button id="deep" type="button">x</button></div>
        </main>
      </div>
    `
    document.body.append(shell)
    scroller = document.getElementById('scroller')!
  })
  afterEach(() => shell.remove())

  const measure = (scrollTop: number) => {
    scroller.scrollTop = scrollTop
    return auditPage(2000, 3000)
  }
  const textY = (r: ReturnType<typeof auditPage>, id: string) => r.text.find(t => t.element === `p#${id}`)?.rect.y
  const targetY = (r: ReturnType<typeof auditPage>, id: string) => r.targets.find(t => t.element === `button#${id}`)?.rect.y

  it('measures the same page wherever the scroller has been left', () => {
    const atTop = measure(0)
    const down = measure(600)
    expect(scroller.scrollTop).toBe(600) // the fixture really scrolls; otherwise the test proves nothing

    // Row 1 is above the fold at 600: it used to be dropped as "off the page".
    expect(textY(atTop, 'row1')).toBeCloseTo(48, 0)
    expect(textY(down, 'row1')).toBeCloseTo(48, 0)
    expect(textY(atTop, 'row13')).toBeCloseTo(48 + 12 * 120, 0)
    expect(textY(down, 'row13')).toBeCloseTo(48 + 12 * 120, 0)
    expect(targetY(down, 'deep')).toBeCloseTo(targetY(atTop, 'deep')!, 0)

    expect(down.targets.length).toBe(atTop.targets.length)
    expect(down.text.length).toBe(atTop.text.length)
    expect(down.pageHeight).toBe(atTop.pageHeight)
    expect(atTop.pageHeight).toBeGreaterThan(innerHeight)
  })

  it('leaves what is outside the scroller where the window puts it', () => {
    const atTop = measure(0)
    const down = measure(600)
    // The shell's own chrome, and button#big from the file-level `#host` fixture
    // (an unrelated top-level fixture that happens to share the id "host" — not
    // the scroll host `#scroller` this describe operates on): both are outside
    // the scroller entirely, so neither moves with it.
    expect(targetY(down, 'menu')).toBeCloseTo(targetY(atTop, 'menu')!, 0)
    expect(targetY(down, 'big')).toBeCloseTo(targetY(atTop, 'big')!, 0)
  })

  it('works as the shipped source with a scrolled host', () => {
    scroller.scrollTop = 600
    // eslint-disable-next-line no-new-func
    const fromSource = new Function(`return ${AUDIT_SCRIPT}`)() as typeof auditPage
    expect(fromSource(2000, 3000)).toEqual(auditPage(2000, 3000))
  })
})
