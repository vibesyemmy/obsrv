import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LINT_SCRIPT, lintPage } from '../../src/shared/lint'

/**
 * `lintPage` runs inside the target page and means nothing without real
 * layout, so it is tested in a real browser, like `auditPage`. Only the
 * page-coordinate rule is covered here; the rules themselves are judged on
 * the parser side (tests/unit/cliLint.test.ts) and end to end.
 */

const EDGE_BELOW_PX = 1 // one device pixel on a 1x screen, in CSS px

/**
 * An app shell: the document cannot scroll, an inner container does. Page
 * coordinates used to add `window.scrollY` — 0 here however far the inner
 * scroller has gone — so once it was scrolled down, everything above the fold
 * was dropped as parked off the page and pageHeight collapsed to the viewport
 * (audit.test.ts has the same fixture and the measurement that found it).
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
        #scroller p { margin: 0; font-size: 16px; color: #111; }
        #menu { font-size: 16px; }
      </style>
      <div id="shell">
        <header id="chrome"><button id="menu" type="button">Menu</button></header>
        <main id="scroller">
          ${Array.from({ length: 20 }, (_, i) => `<div class="row"><p id="row${i + 1}">Row ${i + 1}</p></div>`).join('')}
        </main>
      </div>
    `
    document.body.append(shell)
    scroller = document.getElementById('scroller')!
  })
  afterEach(() => shell.remove())

  const measure = async (scrollTop: number) => {
    scroller.scrollTop = scrollTop
    return lintPage(EDGE_BELOW_PX, 3000, 2000, 500)
  }
  const textY = (r: Awaited<ReturnType<typeof lintPage>>, id: string) => r.text.find(t => t.element === `p#${id}`)?.rect.y

  it('measures the same page wherever the scroller has been left', async () => {
    const atTop = await measure(0)
    const down = await measure(600)
    expect(scroller.scrollTop).toBe(600)

    expect(textY(atTop, 'row1')).toBeCloseTo(48, 0)
    expect(textY(down, 'row1')).toBeCloseTo(48, 0)
    expect(textY(down, 'row13')).toBeCloseTo(48 + 12 * 120, 0)
    expect(down.text.length).toBe(atTop.text.length)
    expect(down.pageHeight).toBe(atTop.pageHeight)
    expect(atTop.pageHeight).toBeGreaterThan(innerHeight)
  })

  it('leaves what is outside the scroller where the window puts it', async () => {
    const atTop = await measure(0)
    const down = await measure(600)
    const menu = (r: Awaited<ReturnType<typeof lintPage>>) => r.text.find(t => t.element === 'button#menu')?.rect.y
    expect(menu(down)).toBeCloseTo(menu(atTop)!, 0)
  })

  it('works as the shipped source, which must be self-contained', async () => {
    scroller.scrollTop = 600
    // eslint-disable-next-line no-new-func
    const fromSource = new Function(`return ${LINT_SCRIPT}`)() as typeof lintPage
    expect(await fromSource(EDGE_BELOW_PX, 3000, 2000, 500)).toEqual(await lintPage(EDGE_BELOW_PX, 3000, 2000, 500))
  })
})
