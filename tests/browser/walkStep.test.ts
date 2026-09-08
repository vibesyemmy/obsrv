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
  document.body.style.overflow = ''
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
})
