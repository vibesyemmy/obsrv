import { afterEach, describe, expect, it } from 'vitest'
import { shadowContent } from '../../src/shared/scrollHost'

/**
 * What the measurement cannot see, counted so the answer can say it.
 *
 * chromestatus.com/features (2026-09-12) answered 0 targets and 0 text while
 * holding 159 shadow roots with 136 interactive elements in them, and the
 * note offered a script that had not run, a bot wall, and an empty document
 * — all three false. Counting is what lets the sentence name the true cause;
 * it needs real shadow roots, so it is tested in a browser.
 */

let host: HTMLDivElement | null = null

function mount(build: (root: HTMLElement) => void): void {
  host = document.createElement('div')
  document.body.append(host)
  build(host)
}

afterEach(() => {
  host?.remove()
  host = null
})

/** A custom element whose content lives in an open shadow root. */
function card(into: HTMLElement, links: number, paragraphs: number): HTMLElement {
  const el = document.createElement('div')
  const root = el.attachShadow({ mode: 'open' })
  for (let i = 0; i < links; i++) {
    const a = document.createElement('a')
    a.href = '#x'
    a.textContent = `link ${i}`
    root.append(a)
  }
  for (let i = 0; i < paragraphs; i++) {
    const p = document.createElement('p')
    p.textContent = `paragraph ${i}`
    root.append(p)
  }
  into.append(el)
  return el
}

describe('shadowContent', () => {
  it('finds nothing on a page with no shadow roots', () => {
    mount(root => {
      root.innerHTML = '<a href="#a">an ordinary link</a><p>ordinary text</p>'
    })
    expect(shadowContent()).toEqual({ hosts: 0, interactive: 0, text: 0 })
  })

  it('counts the hosts and what they hold', () => {
    mount(root => {
      card(root, 2, 1)
      card(root, 1, 2)
    })
    const c = shadowContent()
    expect(c.hosts).toBe(2)
    expect(c.interactive).toBe(3)
    // The <a>s carry text of their own too, so text counts them as well.
    expect(c.text).toBeGreaterThanOrEqual(3)
  })

  it('reaches a root nested inside another root', () => {
    mount(root => {
      const outer = card(root, 1, 0)
      card(outer.shadowRoot as unknown as HTMLElement, 1, 0)
    })
    expect(shadowContent().hosts).toBe(2)
    expect(shadowContent().interactive).toBe(2)
  })

  it('cannot see into a closed root, and does not pretend to', () => {
    mount(root => {
      const el = document.createElement('div')
      const closed = el.attachShadow({ mode: 'closed' })
      const a = document.createElement('a')
      a.href = '#x'
      a.textContent = 'unreachable'
      closed.append(a)
      root.append(el)
    })
    expect(shadowContent()).toEqual({ hosts: 0, interactive: 0, text: 0 })
  })

  it('ignores what the light DOM already offers, so the count is what is missed', () => {
    mount(root => {
      root.innerHTML = '<a href="#a">counted by the measurement itself</a>'
      card(root, 1, 0)
    })
    expect(shadowContent().interactive).toBe(1)
  })
})
