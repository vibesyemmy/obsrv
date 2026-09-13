import { afterEach, describe, expect, it } from 'vitest'
import { shadowContent } from '../../src/shared/scrollHost'

/**
 * The counts on both sides of the share are of what a measurement would have
 * kept. Before the filter, the web-components fixture reported 26 text
 * elements inside its roots and the answer beside it said the page had no
 * visible text — two numbers on one screen that could not both be right
 * (the sweep, 2026-09-13).
 */
let host: HTMLDivElement | null = null
afterEach(() => { host?.remove(); host = null })

function mount(build: (root: HTMLElement) => void): void {
  host = document.createElement('div')
  document.body.append(host)
  build(host)
}

describe('what the share counts', () => {
  it('leaves out what a measurement would have discarded, on both sides', () => {
    mount(root => {
      const el = document.createElement('div')
      const shadow = el.attachShadow({ mode: 'open' })
      // Two visible, two that no measurement would keep.
      for (const [text, style] of [['seen', ''], ['also seen', ''], ['gone', 'display:none'], ['faded', 'opacity:0']] as const) {
        const p = document.createElement('p')
        p.textContent = text
        if (style) p.setAttribute('style', style)
        shadow.append(p)
      }
      const a = document.createElement('a'); a.href = '#x'; a.textContent = 'visible link'; shadow.append(a)
      const hiddenLink = document.createElement('a'); hiddenLink.href = '#y'; hiddenLink.textContent = 'hidden'
      hiddenLink.setAttribute('style', 'visibility:hidden'); shadow.append(hiddenLink)
      root.append(el)
      // The same pair in the light DOM, so the denominator is filtered too.
      root.insertAdjacentHTML('beforeend', '<p>light seen</p><p style="display:none">light gone</p>')
    })
    const c = shadowContent()
    // 2 visible paragraphs + the visible link's own text; the display:none and
    // opacity:0 paragraphs and the visibility:hidden link are not counted.
    expect(c.text).toBe(3)
    expect(c.interactive).toBe(1)
    expect(c.lightText).toBe(1)
  })
})
