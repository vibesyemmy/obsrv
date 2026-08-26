import { describe, it, expect, afterEach, beforeAll, afterAll } from 'vitest'
import { MAX_VISITED, findScroller, resolveScroller } from '../../src/preload/sync'

/**
 * `findScroller` is the riskiest new logic in the scroll round-trip and it
 * only means anything against real layout, so it is tested in a real browser
 * rather than a DOM shim. The sync preload imports `electron`; the browser
 * project aliases that to tests/browser/stubs/electron.ts (see
 * vitest.config.ts), so importing the module here is safe and its
 * module-scope `ipcRenderer.on` is recorded rather than executed.
 */

let host: HTMLDivElement

/**
 * Builds a subtree and returns the walk root. The default box is wider than
 * the runner's viewport, which is harmless for `findScroller` (it measures each
 * candidate's own client box) but would give the *root* something to scroll —
 * so the cache tests below, which depend on a stuck root, pass a narrow one.
 */
function mount(html: string, cssText = 'position:absolute;top:0;left:0;width:600px;height:400px'): HTMLElement {
  host = document.createElement('div')
  host.style.cssText = cssText
  host.innerHTML = html
  document.body.appendChild(host)
  return host
}

/** A box that always fits the runner viewport, for the app-shell cache tests. */
const NARROW = 'position:absolute;top:0;left:0;width:200px;height:300px'

afterEach(() => {
  host?.remove()
})

const scrollerStyle = (w: number, h: number): string =>
  `overflow-y:auto;width:${w}px;height:${h}px`
/** Enough content to overflow any box we build here. */
const FILLER = '<div style="height:5000px">filler</div>'

describe('findScroller', () => {
  it('picks the largest scrollable box by client area', () => {
    const root = mount(`
      <div id="small" style="${scrollerStyle(100, 100)}">${FILLER}</div>
      <div id="big" style="${scrollerStyle(500, 300)}">${FILLER}</div>
      <div id="medium" style="${scrollerStyle(200, 200)}">${FILLER}</div>
    `)
    expect(findScroller(root)?.id).toBe('big')
  })

  it('ignores boxes with nothing to scroll, and non-auto/scroll overflow', () => {
    const root = mount(`
      <div id="roomy" style="${scrollerStyle(500, 300)}"><div style="height:10px">short</div></div>
      <div id="clipped" style="overflow:hidden;width:400px;height:300px">${FILLER}</div>
      <div id="real" style="${scrollerStyle(200, 200)}">${FILLER}</div>
    `)
    expect(findScroller(root)?.id).toBe('real')
  })

  it('breaks an exact area tie depth-first, keeping the one found first', () => {
    const root = mount(`
      <div id="outer" style="${scrollerStyle(300, 200)}">
        <div id="inner" style="${scrollerStyle(300, 200)}">${FILLER}</div>
        ${FILLER}
      </div>
      <div id="later" style="${scrollerStyle(300, 200)}">${FILLER}</div>
    `)
    // #outer, #inner and #later all present the same client area; document
    // order decides, and the walk must reach #outer before its own child.
    const areas = ['outer', 'inner', 'later'].map(id => {
      const el = document.getElementById(id)!
      return el.clientWidth * el.clientHeight
    })
    expect(new Set(areas).size).toBe(1)
    expect(findScroller(root)?.id).toBe('outer')
  })

  it('sees through a boxless wrapper: an inline element hides nothing beneath it', () => {
    // A <span> around block content reports clientWidth/Height 0 while having
    // real client rects. Pruning on client area alone hid every scroller under
    // wrappers like this.
    const root = mount(`<span id="wrap"><div id="deep" style="${scrollerStyle(400, 300)}">${FILLER}</div></span>`)
    expect(document.getElementById('wrap')!.clientHeight).toBe(0)
    expect(document.getElementById('wrap')!.getClientRects().length).toBeGreaterThan(0)
    expect(findScroller(root)?.id).toBe('deep')
  })

  it('sees through a display:contents wrapper too', () => {
    // display: contents is the harder half: no box *and* no client rects, and
    // checkVisibility answers false for it exactly as it does for display:none.
    const root = mount(`<div id="wrap" style="display:contents"><div id="deep" style="${scrollerStyle(400, 300)}">${FILLER}</div></div>`)
    const wrap = document.getElementById('wrap')!
    expect(wrap.getClientRects().length).toBe(0)
    expect(wrap.checkVisibility()).toBe(false)
    expect(findScroller(root)?.id).toBe('deep')
  })

  it('never picks a hidden drawer that kept its client area', () => {
    for (const hide of ['visibility:hidden', 'opacity:0']) {
      const root = mount(`
        <div id="drawer" style="${scrollerStyle(500, 300)};${hide}">${FILLER}</div>
        <div id="shown" style="${scrollerStyle(200, 150)}">${FILLER}</div>
      `)
      // The drawer really is the larger box — it is excluded on visibility.
      expect(document.getElementById('drawer')!.clientHeight).toBe(300)
      expect(findScroller(root)?.id).toBe('shown')
      host.remove()
    }
  })

  it('never picks anything inside a display:none subtree', () => {
    const root = mount(`
      <div id="offscreen" style="display:none">
        <div id="hiddenScroller" style="${scrollerStyle(500, 300)}">${FILLER}</div>
      </div>
      <div id="shown" style="${scrollerStyle(200, 150)}">${FILLER}</div>
    `)
    expect(findScroller(root)?.id).toBe('shown')
  })

  it('returns null when the page has no inner scroller at all', () => {
    const root = mount(`<div style="width:300px;height:100px">plain</div>`)
    expect(findScroller(root)).toBeNull()
  })

  it('degrades predictably past MAX_VISITED instead of walking forever', () => {
    // A wide fan of empty siblings ahead of the scroller in document order:
    // the budget runs out first, so the scroller is not found and the caller
    // falls back to the root rather than stalling the preload.
    const decoys = `<i></i>`.repeat(MAX_VISITED + 50)
    const root = mount(`${decoys}<div id="late" style="${scrollerStyle(400, 300)}">${FILLER}</div>`)
    expect(findScroller(root)).toBeNull()

    // The same scroller inside the budget is found normally.
    host.remove()
    const near = mount(`${`<i></i>`.repeat(10)}<div id="early" style="${scrollerStyle(400, 300)}">${FILLER}</div>`)
    expect(findScroller(near)?.id).toBe('early')
  })
})

/**
 * `resolveScroller` reads the whole document, so these turn the test page into
 * the app-shell shape for their duration: the runner's own markup is hidden
 * (it would otherwise give the root something to scroll and short-circuit the
 * search) and html/body are pinned to the viewport with overflow hidden.
 */
describe('resolveScroller cache', () => {
  const previous = { html: '', body: '' }
  const runnerNodes: Array<{ el: HTMLElement; display: string }> = []

  beforeAll(() => {
    previous.html = document.documentElement.style.cssText
    previous.body = document.body.style.cssText
    for (const el of Array.from(document.body.children)) {
      if (!(el instanceof HTMLElement)) continue
      runnerNodes.push({ el, display: el.style.display })
      el.style.display = 'none'
    }
    document.documentElement.style.cssText = 'height:100%;overflow:hidden'
    document.body.style.cssText = 'height:100%;overflow:hidden;margin:0'
  })
  afterAll(() => {
    for (const { el, display } of runnerNodes) el.style.display = display
    document.documentElement.style.cssText = previous.html
    document.body.style.cssText = previous.body
  })

  /**
   * The premise of every test here; a runner change that broke it must shout.
   * Both axes: a fixture wider than the viewport makes the root scrollable
   * sideways, which short-circuits the search just as a tall one does.
   */
  const rootIsStuck = (): boolean => {
    const el = document.scrollingElement!
    return el.scrollHeight <= el.clientHeight + 1 && el.scrollWidth <= el.clientWidth + 1
  }

  it('re-resolves when the cached scroller is swapped out from under it (SPA route change)', () => {
    mount(`<div id="first" style="${scrollerStyle(150, 200)}">${FILLER}</div>`, NARROW)
    expect(rootIsStuck()).toBe(true)
    expect(resolveScroller()?.id).toBe('first')
    // Cached: the same element comes back without a fresh walk.
    expect(resolveScroller()?.id).toBe('first')

    // The route swaps its scroller for a different one.
    host.innerHTML = `<div id="second" style="${scrollerStyle(150, 200)}">${FILLER}</div>`
    expect(resolveScroller()?.id).toBe('second')
  })

  it('re-resolves when the cached scroller stops being able to scroll', () => {
    mount(
      `<div id="a" style="${scrollerStyle(150, 200)}">${FILLER}</div>
       <div id="b" style="${scrollerStyle(100, 80)}">${FILLER}</div>`,
      NARROW,
    )
    expect(rootIsStuck()).toBe(true)
    expect(resolveScroller()?.id).toBe('a')

    // #a stays attached but its content collapses: it is no longer a scroller.
    document.getElementById('a')!.innerHTML = '<div style="height:4px">short</div>'
    expect(resolveScroller()?.id).toBe('b')
  })

  it('prefers the root the moment the root can scroll again', () => {
    mount(`<div id="inner" style="${scrollerStyle(150, 200)}">${FILLER}</div>`, NARROW)
    expect(rootIsStuck()).toBe(true)
    expect(resolveScroller()?.id).toBe('inner')

    document.documentElement.style.cssText = 'overflow:auto'
    document.body.style.cssText = 'margin:0'
    host.style.height = '5000px'
    expect(rootIsStuck()).toBe(false)
    expect(resolveScroller()).toBeNull()

    document.documentElement.style.cssText = 'height:100%;overflow:hidden'
    document.body.style.cssText = 'height:100%;overflow:hidden;margin:0'
  })
})
