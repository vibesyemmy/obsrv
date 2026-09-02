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
    const tiny = r.targets.find(t => t.element === 'button#tiny')!
    expect(tiny.rect.width).toBe(24)
    expect(tiny.rect.height).toBe(24)
    expect(tiny.text).toBe('×')
    expect(r.targets.find(t => t.element === 'input#field')!.text).toBe('typed')
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
