import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { installStuckChrome, STUCK_BAR_MAX_HEIGHT, STUCK_BAR_MIN_WIDTH, STUCK_CHROME_SCRIPT, STUCK_MAX_SCANNED, type StuckChrome } from '../../src/shared/stuckChrome'

/**
 * Only real layout can say what stays put while a page scrolls, so this runs
 * in a browser. The fixture carries one of each shape measured on real pages:
 * a `fixed` bar (tailwindcss.com/docs), a `sticky` bar (developer.mozilla.org)
 * and a `sticky` rail (both of them).
 */

let page: HTMLDivElement
let chrome: StuckChrome

beforeEach(() => {
  page = document.createElement('div')
  page.innerHTML = `
    <style>
      html, body { margin: 0; }
      #fixed-bar { position: fixed; inset: 0 0 auto 0; height: 48px; background: #101828; z-index: 10; }
      #sticky-bar { position: sticky; top: 48px; height: 40px; background: #2563eb; }
      #rail { position: sticky; top: 88px; float: left; width: 15%; height: 300px; background: #eee; }
      #overlay { position: fixed; inset: 0; background: rgba(0,0,0,.5); display: none; }
      /* The sticky bar starts below its stick point, as a real page's does. */
      #lede { height: 200px; }
      #flow-bar { height: 40px; background: #ddd; }
      #body-copy { height: 6000px; }
    </style>
    <div id="fixed-bar"></div>
    <div id="lede"></div>
    <div id="sticky-bar"></div>
    <div id="rail"></div>
    <div id="overlay"></div>
    <div id="flow-bar"></div>
    <div id="body-copy"></div>
  `
  document.body.append(page)
  chrome = installStuckChrome(STUCK_BAR_MIN_WIDTH, STUCK_BAR_MAX_HEIGHT, STUCK_MAX_SCANNED, null)
})

afterEach(() => {
  chrome.restore()
  window.scrollTo(0, 0)
  page.remove()
})

/** Two scroll offsets, both past the first band — see the module's comment. */
const probe = (a: number, b: number): ReturnType<StuckChrome['settle']> => {
  window.scrollTo(0, a)
  chrome.mark()
  window.scrollTo(0, b)
  return chrome.settle()
}

describe('finding stuck chrome', () => {
  it('finds a bar however the page stuck it, by measurement rather than by `position`', () => {
    const bars = probe(800, 1600)
    const found = bars.map(b => b.element).sort()
    expect(found).toEqual(['div#fixed-bar', 'div#sticky-bar'])
    // Both values do this on real pages, so both must come back.
    expect(bars.find(b => b.element === 'div#fixed-bar')!.position).toBe('fixed')
    expect(bars.find(b => b.element === 'div#sticky-bar')!.position).toBe('sticky')
  })

  it('leaves a rail alone: it covers no page content, and hiding it blanks a column', () => {
    expect(probe(800, 1600).map(b => b.element)).not.toContain('div#rail')
  })

  it('leaves what scrolls away alone', () => {
    expect(probe(800, 1600).map(b => b.element)).not.toContain('div#flow-bar')
  })

  it('misses sticky chrome if the first offset is the top of the page, which is why the probe scrolls twice', () => {
    // The false negative that decided the probe, reproduced on MDN: at scroll
    // 0 a sticky bar is at its natural place, so comparing 0 against a later
    // band shows it moving and calls it not stuck. The `fixed` bar, which is
    // stuck from the first pixel, comes back either way.
    const fromTop = probe(0, 1600).map(b => b.element)
    expect(fromTop).toContain('div#fixed-bar')
    expect(fromTop).not.toContain('div#sticky-bar')
  })

  it('does not list a bar nested inside another: the ancestor hides it', () => {
    const outer = document.getElementById('fixed-bar')!
    const inner = document.createElement('div')
    inner.id = 'inner-bar'
    inner.style.cssText = 'position: sticky; top: 0; height: 20px; width: 100%;'
    outer.append(inner)
    expect(probe(800, 1600).map(b => b.element)).toEqual(['div#fixed-bar', 'div#sticky-bar'])
  })

  it('leaves a full-screen overlay alone: that is not chrome', () => {
    const overlay = document.getElementById('overlay')!
    overlay.style.display = 'block'
    expect(probe(800, 1600).map(b => b.element)).not.toContain('div#overlay')
  })
})

describe('hiding and restoring', () => {
  it('hides by visibility, so the page is laid out exactly as it was', () => {
    const bar = document.getElementById('fixed-bar')!
    const copy = document.getElementById('body-copy')!
    probe(800, 1600)
    const before = copy.getBoundingClientRect().top
    chrome.hide()
    expect(getComputedStyle(bar).visibility).toBe('hidden')
    // The whole point: no reflow, so the bands still stitch.
    expect(copy.getBoundingClientRect().top).toBe(before)
  })

  it('puts an untouched element back with no inline visibility at all', () => {
    const bar = document.getElementById('fixed-bar')!
    probe(800, 1600)
    chrome.hide()
    chrome.restore()
    expect(bar.style.getPropertyValue('visibility')).toBe('')
  })

  it("keeps a page's own inline visibility, value and priority", () => {
    const bar = document.getElementById('sticky-bar')!
    bar.style.setProperty('visibility', 'visible', 'important')
    probe(800, 1600)
    chrome.hide()
    chrome.restore()
    expect(bar.style.getPropertyValue('visibility')).toBe('visible')
    expect(bar.style.getPropertyPriority('visibility')).toBe('important')
  })

  it('restores after hiding twice, as a band loop does', () => {
    const bar = document.getElementById('fixed-bar')!
    probe(800, 1600)
    chrome.hide()
    chrome.hide()
    chrome.restore()
    expect(bar.style.getPropertyValue('visibility')).toBe('')
  })
})

describe('the shipped source', () => {
  it('installs the controller on the page, which must be self-contained', () => {
    // eslint-disable-next-line no-new-func
    new Function(STUCK_CHROME_SCRIPT)()
    const installed = (window as unknown as { __obsrvChrome: StuckChrome }).__obsrvChrome
    window.scrollTo(0, 800)
    installed.mark()
    window.scrollTo(0, 1600)
    expect(installed.settle().map(b => b.element).sort()).toEqual(['div#fixed-bar', 'div#sticky-bar'])
    installed.restore()
  })
})

/**
 * An app shell bands by scrolling an element, not the window, so the frame for
 * every measurement is that element's box. Its own sticky toolbar repeats in
 * the bands; the app chrome around it is sliced out of them already, and a bar
 * spanning a scroller inset from the window is not full-bleed against the
 * viewport at all.
 */
describe('a shell that scrolls an element', () => {
  let shell: HTMLDivElement
  let scroller: HTMLElement
  let chrome: StuckChrome

  beforeEach(() => {
    // The file-level page fixture is a different shape — a document that
    // scrolls, with its own viewport-wide bars. Those bars overlap this
    // scroller and would be found (rightly: a page-level fixed bar does paint
    // over an app shell's content), which is not what these tests are about.
    page.remove()
    shell = document.createElement('div')
    shell.innerHTML = `
      <style>
        /* The wrapper is fixed and full-bleed and never moves — the shape that
           must never be hidden, since it holds the scroller. */
        #app { position: fixed; inset: 0; background: #fff; display: flex; flex-direction: column; }
        #app-header { height: 56px; background: #101828; }
        #app-body { flex: 1 1 auto; min-height: 0; display: flex; }
        #app-nav { width: 200px; background: #f3f4f6; }
        #scroller { flex: 1 1 auto; min-height: 0; overflow-y: auto; }
        #toolbar { position: sticky; top: 0; height: 44px; background: #2563eb; }
        #panel-rail { position: sticky; top: 44px; float: right; width: 12%; height: 200px; background: #eee; }
        .row { height: 400px; }
      </style>
      <div id="app">
        <header id="app-header"></header>
        <div id="app-body">
          <nav id="app-nav"></nav>
          <main id="scroller">
            <div id="toolbar"></div>
            <div id="panel-rail"></div>
            <div class="row"></div><div class="row"></div><div class="row"></div>
            <div class="row"></div><div class="row"></div><div class="row"></div>
          </main>
        </div>
      </div>
    `
    document.body.append(shell)
    scroller = document.getElementById('scroller')!
    chrome = installStuckChrome(STUCK_BAR_MIN_WIDTH, STUCK_BAR_MAX_HEIGHT, STUCK_MAX_SCANNED, scroller)
  })
  afterEach(() => {
    chrome.restore()
    shell.remove()
  })

  const probeShell = (a: number, b: number): ReturnType<StuckChrome['settle']> => {
    scroller.scrollTop = a
    chrome.mark()
    scroller.scrollTop = b
    return chrome.settle()
  }

  it("finds the scroller's own sticky toolbar, which is nowhere near full-bleed against the viewport", () => {
    const bars = probeShell(400, 800)
    expect(bars.map(b => b.element)).toEqual(['div#toolbar'])
    // The frame is the scroller: the toolbar spans it but not the window.
    expect(scroller.clientWidth).toBeLessThan(innerWidth)
  })

  it('leaves the app chrome around the scroller alone: the bands slice it out already', () => {
    const found = probeShell(400, 800).map(b => b.element)
    expect(found).not.toContain('header#app-header')
    expect(found).not.toContain('nav#app-nav')
  })

  it('never hides what holds the scroller, however stuck and full-bleed it is', () => {
    // `#app` is fixed, covers everything and cannot move — and hiding it would
    // blank the capture it is supposed to be improving.
    expect(probeShell(400, 800).map(b => b.element)).not.toContain('div#app')
  })

  it('leaves a rail inside the scroller alone, as it does one on a page', () => {
    expect(probeShell(400, 800).map(b => b.element)).not.toContain('div#panel-rail')
  })

  it('hides and restores the toolbar without moving the rows behind it', () => {
    const row = shell.querySelector('.row') as HTMLElement
    probeShell(400, 800)
    const before = row.getBoundingClientRect().top
    chrome.hide()
    expect(getComputedStyle(document.getElementById('toolbar')!).visibility).toBe('hidden')
    expect(row.getBoundingClientRect().top).toBe(before)
    chrome.restore()
    expect(getComputedStyle(document.getElementById('toolbar')!).visibility).toBe('visible')
  })
})
