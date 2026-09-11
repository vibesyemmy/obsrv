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

  it('judges text on the background painted under it, a scrim from another branch included', async () => {
    const scrim = document.createElement('div')
    scrim.id = 'scrim'
    scrim.style.cssText = 'position:absolute;left:0;top:100px;width:300px;height:40px;background:rgb(41,42,43);z-index:5'
    const over = document.createElement('p')
    over.id = 'over'
    over.textContent = 'Reject all cookies'
    over.style.cssText = 'position:absolute;left:10px;top:110px;margin:0;font-size:14px;color:rgb(239,240,243);z-index:6'
    shell.append(scrim, over)
    const r = await lintPage(EDGE_BELOW_PX, 3000, 2000, 500)
    const t = r.text.find(x => x.element === 'p#over')!
    expect(t.background).toEqual([41, 42, 43, 1])
    expect(t.backgroundNote).toBe('computed')
  })

  it('a file of a pixel or two on a side is a spacer: counted, never listed as an image', async () => {
    const spacer = document.createElement('img')
    spacer.id = 'spacer'
    spacer.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
    spacer.style.cssText = 'display:block;width:26px;height:1px'
    scroller.prepend(spacer)
    await spacer.decode()
    // The same 1×1 with a data-src is a lazy loader's placeholder, not a spacer.
    const lazy = document.createElement('img')
    lazy.id = 'lazy'
    lazy.src = spacer.src
    lazy.setAttribute('data-src', 'https://x.test/real.png')
    lazy.style.cssText = 'display:block;width:200px;height:200px'
    scroller.prepend(lazy)
    await lazy.decode()
    const r = await lintPage(EDGE_BELOW_PX, 3000, 2000, 500)
    expect(r.images.find(i => i.element === 'img#spacer')).toBeUndefined()
    expect(r.images.find(i => i.element === 'img#lazy')).toMatchObject({ naturalWidth: 1, naturalHeight: 1 })
    expect(r.spacers).toBe(1)
  })

  it('reports how each image is fitted into its box, so the judge can follow the right axis', async () => {
    // A 4×4 PNG (a 1×1 would be a spacer and left out): every box is an upscale; only the fit is under test here.
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAE0lEQVR4nGM0TpvJAANMcBZeDgA8YgE6ReZ83QAAAABJRU5ErkJggg=='
    const fits = ['cover', 'contain', 'fill', 'none', 'scale-down'] as const
    const imgs = fits.map(fit => {
      const img = document.createElement('img')
      img.id = `fit-${fit}`
      img.style.cssText = `display:block;width:40px;height:20px;object-fit:${fit}`
      img.src = png
      scroller.prepend(img)
      return img
    })
    await Promise.all(imgs.map(i => i.decode()))
    const r = await lintPage(EDGE_BELOW_PX, 3000, 2000, 500)
    for (const fit of fits) expect(r.images.find(i => i.element === `img#fit-${fit}`)?.objectFit).toBe(fit)
  })

  it('works as the shipped source, which must be self-contained', async () => {
    scroller.scrollTop = 600
    // eslint-disable-next-line no-new-func
    const fromSource = new Function(`return ${LINT_SCRIPT}`)() as typeof lintPage
    expect(await fromSource(EDGE_BELOW_PX, 3000, 2000, 500)).toEqual(await lintPage(EDGE_BELOW_PX, 3000, 2000, 500))
  })
})

/**
 * A srcset is "url descriptor, url descriptor", and the comma needs no space
 * after it. Reuters writes it that way and the whole page's lint was lost to
 * it: splitting on whitespace alone glued the next URL onto the descriptor,
 * which came back 254 characters long and was refused
 * (docs/research/2026-09-11-live-run-0.53.0.md). A data URL carries commas of
 * its own, which is why the split cannot simply be on every comma.
 */
describe('the candidates an <img> offered', () => {
  const revoke: string[] = []
  let host: HTMLDivElement

  /** A real file, so the image has a natural size and is measured at all. */
  async function png(side: number): Promise<string> {
    const canvas = new OffscreenCanvas(side, side)
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#3366aa'
    ctx.fillRect(0, 0, side, side)
    const url = URL.createObjectURL(await canvas.convertToBlob({ type: 'image/png' }))
    revoke.push(url)
    return url
  }

  beforeEach(() => {
    host = document.createElement('div')
    document.body.append(host)
  })

  afterEach(() => {
    host.remove()
    for (const url of revoke.splice(0)) URL.revokeObjectURL(url)
  })

  async function candidatesOf(srcset: string, src: string): Promise<string[] | undefined> {
    const img = document.createElement('img')
    img.id = 'shot'
    img.style.cssText = 'display:block;width:48px;height:48px'
    img.srcset = srcset
    img.src = src
    host.append(img)
    await img.decode()
    const r = await lintPage(EDGE_BELOW_PX, 3000, 2000, 500)
    return r.images.find(i => i.element === 'img#shot')?.candidates
  }

  it('reads the descriptors when the comma has no space after it', async () => {
    const small = await png(60)
    const large = await png(240)
    expect(await candidatesOf(`${small} 60w,${large} 240w`, small)).toEqual(['60w', '240w'])
  })

  it('reads them when a space follows the comma', async () => {
    const small = await png(60)
    const large = await png(240)
    expect(await candidatesOf(`${small} 60w, ${large} 240w`, small)).toEqual(['60w', '240w'])
  })

  it("does not split a data URL on its own comma, with or without one after the descriptor", async () => {
    // A 4x4 PNG: small enough to write out, big enough not to be a spacer.
    const data =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAE0lEQVR4nGM0TpvJAANMcBZeDgA8YgE6ReZ83QAAAABJRU5ErkJggg=='
    const large = await png(240)
    expect(await candidatesOf(`${data} 1x,${large} 2x`, data)).toEqual(['1x', '2x'])
  })
})
