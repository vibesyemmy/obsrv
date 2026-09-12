import { describe, it, expect, afterEach } from 'vitest'
import { WALK_STEP_SCRIPT, walkStep } from '../../src/shared/scrollHost'

/**
 * `walkStep` is the headless walk's one page-side move: a screenful of
 * whichever element the page scrolls, with the live `scroll { page }`'s
 * arithmetic — `next` is the scroller's own client height, `atEnd` is the
 * offset that can go no further. Real layout only, like `findScroller`.
 */

let host: HTMLDivElement | null = null

function mount(html: string): void {
  host = document.createElement('div')
  host.innerHTML = html
  document.body.appendChild(host)
}

afterEach(() => {
  host?.remove()
  host = null
  document.documentElement.style.overflow = ''
  document.body.style.cssText = ''
  window.scrollTo(0, 0)
})

describe('walkStep', () => {
  it('walks the root a viewport at a time and reports the end', () => {
    mount('<div style="height:2500px">tall</div>')
    const view = window.innerHeight
    expect(walkStep('top')).toMatchObject({ y: 0, scroller: 'root' })
    const first = walkStep('next')
    expect(first.scroller).toBe('root')
    expect(first.y).toBe(view)
    let last = first
    for (let i = 0; i < 10 && !last.atEnd; i++) last = walkStep('next')
    expect(last.atEnd).toBe(true)
    expect(last.y).toBeGreaterThanOrEqual(2500 - view - 1)
    expect(walkStep('top').y).toBe(0)
  })

  it('the serialised form is self-contained: evaluated from source, it walks the same page', () => {
    mount('<div style="height:2500px">tall</div>')
    const fromSource = new Function(`return ${WALK_STEP_SCRIPT}`)() as typeof walkStep
    expect(fromSource('top')).toMatchObject({ y: 0, scroller: 'root' })
    expect(fromSource('next')).toMatchObject({ y: window.innerHeight, scroller: 'root' })
  })

  it('a page that fits its viewport is at the end without moving', () => {
    mount('<div style="height:10px">short</div>')
    const r = walkStep('next')
    expect(r).toMatchObject({ y: 0, atEnd: true, scroller: 'root' })
  })

  it('walks the inner scroller of an app shell, a client height at a time', () => {
    document.documentElement.style.overflow = 'hidden'
    document.body.style.overflow = 'hidden'
    mount('<div id="shell" style="overflow-y:auto;height:200px;width:300px"><div style="height:1000px">filler</div></div>')
    const shell = document.getElementById('shell')!
    const first = walkStep('next')
    expect(first).toMatchObject({ y: 200, scroller: 'element', atEnd: false })
    expect(shell.scrollTop).toBe(200)
    let last = first
    for (let i = 0; i < 10 && !last.atEnd; i++) last = walkStep('next')
    expect(last.atEnd).toBe(true)
    expect(last.y).toBe(800)
    expect(walkStep('top')).toMatchObject({ y: 0, scroller: 'element' })
    expect(shell.scrollTop).toBe(0)
  })

  /**
   * A page locked behind a dialog: the document cannot scroll, and the only
   * scroller in the light DOM is the dialog's own panel. The walk then
   * scrolls the dialog and reports five screenfuls of a 300 px panel, which
   * reads as a walked page. It must say which it moved.
   */
  it('says when the container it scrolled is inside a dialog', () => {
    // The lock every modal library applies: `position: fixed` on the body,
    // which collapses the document's scroll height. `overflow: hidden` alone
    // does not — `rootScrolls` is geometric, and the root still measures
    // taller than its client box.
    document.documentElement.style.overflow = 'hidden'
    document.body.style.cssText = 'position:fixed;top:0;left:0;right:0;overflow:hidden'
    mount(`
      <main style="height:2400px">a page nobody can scroll</main>
      <div role="dialog" aria-modal="true" style="position:fixed;inset:0">
        <div id="panel" style="width:420px;max-height:300px;overflow-y:auto">
          <div style="height:1800px">consent detail</div>
        </div>
      </div>
    `)
    const r = walkStep('next')
    expect(r.scroller).toBe('element')
    expect(r.hidden).toBe(true)
    expect(r.dialog).toBe(true)
  })

  it('an app shell that scrolls its own container is not a dialog', () => {
    document.documentElement.style.overflow = 'hidden'
    document.body.style.overflow = 'hidden'
    mount(`
      <div id="shell" style="position:fixed;inset:0">
        <div id="scroller" style="position:absolute;inset:0;overflow-y:auto">
          <div style="height:2400px">the app's own content</div>
        </div>
      </div>
    `)
    const r = walkStep('next')
    expect(r.scroller).toBe('element')
    expect(r.hidden).toBe(true)
    expect(r.dialog).toBe(false)
  })

  it('a dialog on a page that still scrolls leaves the root the scroller', () => {
    mount(`
      <main style="height:2400px">a page that still scrolls</main>
      <div role="dialog" style="position:fixed;top:0;left:0;width:300px;max-height:200px;overflow-y:auto">
        <div style="height:900px">a panel that scrolls, over a page that also does</div>
      </div>
    `)
    const r = walkStep('next')
    expect(r.scroller).toBe('root')
    expect(r.dialog).toBe(false)
  })

})
