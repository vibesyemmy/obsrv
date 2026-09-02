import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { INSPECT_SCRIPT, inspectAtPoint } from '../../src/shared/inspect'

/**
 * `inspectAtPoint` runs inside the target page, so it is tested against a
 * real DOM with real layout. It is also shipped as *source* and evaluated
 * there, which is why the last test runs the stringified form: a helper the
 * bundler hoisted out of the function would pass every other test here and
 * throw in the target.
 */

let host: HTMLDivElement

beforeEach(() => {
  host = document.createElement('div')
  host.innerHTML = `
    <style>
      #host, #host * { margin: 0; font-family: Arial, sans-serif; }
      #host { position: fixed; left: 0; top: 0; width: 400px; height: 400px; background: #fff; }
      #grey { position: absolute; left: 10px; top: 10px; width: 300px; font-size: 13px; color: rgb(107, 114, 128); }
      #card { position: absolute; left: 10px; top: 60px; width: 300px; height: 80px; background: rgb(17, 17, 17); }
      #card p { padding: 20px; font-size: 16px; font-weight: 700; color: rgb(204, 204, 204); }
      #veil { position: absolute; left: 10px; top: 160px; width: 300px; height: 40px; background: rgba(0, 0, 0, 0.5); }
      #veil span { font-size: 12px; color: rgb(255, 255, 255); }
      #photo { position: absolute; left: 10px; top: 220px; width: 300px; height: 40px; background: linear-gradient(90deg, #000, #fff); }
      #photo span { font-size: 12px; color: rgb(255, 0, 0); }
    </style>
    <p id="grey">Grey caption text on white</p>
    <div id="card"><p id="card-text">Light text on a dark card</p></div>
    <div id="veil"><span id="veil-text">White on a half-black veil</span></div>
    <div id="photo"><span id="photo-text">Red on a gradient</span></div>
  `
  host.id = 'host'
  document.body.append(host)
})
afterEach(() => host.remove())

const centre = (id: string): { x: number; y: number } => {
  const r = document.getElementById(id)!.getBoundingClientRect()
  return { x: r.left + Math.min(20, r.width / 2), y: r.top + r.height / 2 }
}

describe('inspectAtPoint', () => {
  it('reads the element, its font and its colour on the page white', () => {
    const { x, y } = centre('grey')
    const r = inspectAtPoint(x, y)!
    expect(r.tag).toBe('p')
    expect(r.id).toBe('grey')
    expect(r.text).toBe('Grey caption text on white')
    expect(r.fontSizePx).toBe(13)
    expect(r.fontWeight).toBe(400)
    expect(r.fontFamily).toBe('Arial')
    expect(r.color).toEqual([107, 114, 128, 1])
    expect(r.background).toEqual([255, 255, 255, 1])
    expect(r.backgroundNote).toBe('computed')
    expect(r.rect.width).toBeCloseTo(300, 0)
  })
  it('walks up to the first opaque background', () => {
    const { x, y } = centre('card-text')
    const r = inspectAtPoint(x, y)!
    expect(r.id).toBe('card-text')
    expect(r.fontWeight).toBe(700)
    expect(r.color).toEqual([204, 204, 204, 1])
    expect(r.background).toEqual([17, 17, 17, 1])
  })
  it('composites a translucent layer onto what is under it', () => {
    const { x, y } = centre('veil-text')
    const r = inspectAtPoint(x, y)!
    expect(r.id).toBe('veil-text')
    expect(r.background!.slice(0, 3).map(Math.round)).toEqual([128, 128, 128])
  })
  it('refuses to guess under an image or gradient', () => {
    const { x, y } = centre('photo-text')
    const r = inspectAtPoint(x, y)!
    expect(r.id).toBe('photo-text')
    expect(r.background).toBeNull()
    expect(r.backgroundNote).toBe('image')
  })
  it('is null off the document', () => {
    expect(inspectAtPoint(-10, -10)).toBeNull()
  })
  it('works as the shipped source, which must be self-contained', () => {
    // eslint-disable-next-line no-new-func
    const fromSource = new Function(`return ${INSPECT_SCRIPT}`)() as typeof inspectAtPoint
    const { x, y } = centre('card-text')
    expect(fromSource(x, y)).toEqual(inspectAtPoint(x, y))
  })
})
