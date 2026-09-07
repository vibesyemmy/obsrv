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
  chrome = installStuckChrome(STUCK_BAR_MIN_WIDTH, STUCK_BAR_MAX_HEIGHT, STUCK_MAX_SCANNED)
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
