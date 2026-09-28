import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OBSERVE_SCRIPT, observePage } from '../../src/shared/observe'

/**
 * `observePage` runs inside the target page and only means anything against
 * real layout, so it is tested in a real browser — same reasoning and the
 * same `#host` pattern as `tests/browser/audit.test.ts`. The last test runs
 * the stringified form, as that one does.
 */

let host: HTMLDivElement

beforeEach(() => {
  host = document.createElement('div')
  host.id = 'host'
  host.innerHTML = `
    <style>
      #host, #host * { margin: 0; font-family: Arial, sans-serif; }
      #host { position: fixed; left: 0; top: 0; width: 600px; height: 600px; background: #fff; }
      #hidden-vis { visibility: hidden; }
      #hidden-disp { display: none; }
      #hidden-op { opacity: 0; }
      .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
    </style>
    <p id="own">Order confirmed</p>
    <div id="wrap">Wrapper text <span id="child">and child text</span></div>
    <p id="wrapped">
      Hello
      world
    </p>
    <p id="hidden-vis">Ghost by visibility</p>
    <p id="hidden-disp">Ghost by display</p>
    <p id="hidden-op">Ghost by opacity</p>
    <p id="sr" class="sr-only">Screen-reader only text</p>
    <p id="case">UPPER CASE ONLY</p>
    <ul id="list">
      <li>Repeat me</li>
      <li>Repeat me</li>
      <li>Repeat me</li>
    </ul>
  `
  document.body.append(host)
})
afterEach(() => host.remove())

describe('observePage', () => {
  it('finds a rendered element whose own text contains the stated string, with its element label and rect', () => {
    const report = observePage(['Order confirmed'], 20, 20)
    const finding = report.findings[0]!
    expect(finding.renderedCount).toBe(1)
    expect(finding.unrenderedCount).toBe(0)
    expect(finding.matches).toHaveLength(1)
    expect(finding.matches[0]!.element).toBe('p#own')
    expect(finding.matches[0]!.rect.width).toBeGreaterThan(0)
    expect(finding.matches[0]!.rect.height).toBeGreaterThan(0)
  })

  it('counts an element only for text that is its OWN direct text, not a descendant\'s', () => {
    const wrapper = observePage(['Wrapper text'], 20, 20)
    expect(wrapper.findings[0]!.renderedCount).toBe(1)
    expect(wrapper.findings[0]!.matches[0]!.element).toBe('div#wrap')

    const child = observePage(['and child text'], 20, 20)
    expect(child.findings[0]!.renderedCount).toBe(1)
    expect(child.findings[0]!.matches[0]!.element).toBe('span#child')
  })

  it('matches across the whitespace HTML source wraps text in, without folding it into the reported text itself', () => {
    const report = observePage(['Hello world'], 20, 20)
    expect(report.findings[0]!.renderedCount).toBe(1)
    expect(report.findings[0]!.text).toBe('Hello world')
  })

  it('is case-sensitive: the QA engineer\'s own wording is what is searched for', () => {
    const exact = observePage(['UPPER CASE ONLY'], 20, 20)
    expect(exact.findings[0]!.renderedCount).toBe(1)
    const wrongCase = observePage(['upper case only'], 20, 20)
    expect(wrongCase.findings[0]!.renderedCount).toBe(0)
  })

  it('reports no match anywhere as zero, not as an error', () => {
    const report = observePage(['Nothing on this page says this'], 20, 20)
    const f = report.findings[0]!
    expect(f.renderedCount).toBe(0)
    expect(f.unrenderedCount).toBe(0)
    expect(f.matches).toEqual([])
    expect(f.unrendered).toEqual([])
  })

  for (const [id, label] of [
    ['hidden-vis', 'p#hidden-vis'],
    ['hidden-disp', 'p#hidden-disp'],
    ['hidden-op', 'p#hidden-op'],
  ] as const) {
    it(`counts an element hidden by ${id.replace('hidden-', '')} as unrendered, not rendered`, () => {
      const text = document.getElementById(id)!.textContent!.trim()
      const report = observePage([text], 20, 20)
      const f = report.findings[0]!
      expect(f.renderedCount).toBe(0)
      expect(f.unrenderedCount).toBe(1)
      expect(f.unrendered[0]!.element).toBe(label)
    })
  }

  it('counts the 1×1 "visually hidden" (screen-reader-only) pattern as unrendered — nobody looking at the screen sees it', () => {
    const report = observePage(['Screen-reader only text'], 20, 20)
    const f = report.findings[0]!
    expect(f.renderedCount).toBe(0)
    expect(f.unrenderedCount).toBe(1)
  })

  it('searches several stated texts in one pass, answering in the same order as the input', () => {
    const report = observePage(['Order confirmed', 'Ghost by visibility', 'not on the page at all'], 20, 20)
    expect(report.findings.map(f => f.text)).toEqual(['Order confirmed', 'Ghost by visibility', 'not on the page at all'])
    expect(report.findings[0]!.renderedCount).toBe(1)
    expect(report.findings[1]!.unrenderedCount).toBe(1)
    expect(report.findings[2]!.renderedCount).toBe(0)
  })

  it('caps the listed matches at maxMatches while keeping renderedCount exact, and reports how many were cut', () => {
    const report = observePage(['Repeat me'], 2, 20)
    const f = report.findings[0]!
    expect(f.renderedCount).toBe(3)
    expect(f.matches).toHaveLength(2)
    expect(report.truncated.matches).toBe(1)
    expect(report.truncated.unrendered).toBe(0)
  })

  it('caps the listed unrendered entries at maxUnrendered while keeping unrenderedCount exact', () => {
    host.innerHTML += '<p style="display:none">Vanish twice</p><p style="display:none">Vanish twice</p>'
    const report = observePage(['Vanish twice'], 20, 1)
    const f = report.findings[0]!
    expect(f.unrenderedCount).toBe(2)
    expect(f.unrendered).toHaveLength(1)
    expect(report.truncated.unrendered).toBe(1)
  })

  it('reaches into an open shadow root, the same way auditPage does', () => {
    const el = document.createElement('div')
    host.append(el)
    const root = el.attachShadow({ mode: 'open' })
    root.innerHTML = '<p>Inside an open shadow root</p>'
    const report = observePage(['Inside an open shadow root'], 20, 20)
    expect(report.findings[0]!.renderedCount).toBe(1)
  })

  it('does not count a match inside a closed shadow root at all — it is unreachable, not unrendered', () => {
    const el = document.createElement('div')
    host.append(el)
    el.attachShadow({ mode: 'closed' }).innerHTML = '<p>Inside a closed shadow root</p>'
    const report = observePage(['Inside a closed shadow root'], 20, 20)
    const f = report.findings[0]!
    expect(f.renderedCount).toBe(0)
    expect(f.unrenderedCount).toBe(0)
  })

  it('reports the frames block the same way auditPage does, so a string only inside one reads as zero honestly', () => {
    const iframe = document.createElement('iframe')
    iframe.style.width = '200px'
    iframe.style.height = '200px'
    host.append(iframe)
    const report = observePage(['anything'], 20, 20)
    expect(report.frames).toBeDefined()
    expect(report.frames!.count).toBeGreaterThanOrEqual(1)
  })

  it('ships as valid, self-contained source', () => {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const fn = new Function(`return ${OBSERVE_SCRIPT}`)() as typeof observePage
    const report = fn(['Order confirmed'], 20, 20)
    expect(report.findings[0]!.renderedCount).toBe(1)
  })
})
