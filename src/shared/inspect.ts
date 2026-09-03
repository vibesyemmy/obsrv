/// <reference lib="dom" />
// The DOM lib is pulled in for this file alone: `inspectTarget` is written
// here so main can ship it as source, and main's own configuration has no
// DOM. Nothing in this file runs in main except the string.

/**
 * The inspector: what is under a point of the target page — or what a CSS
 * selector names — as the page reports it: element, font, text colour, and
 * the background that colour actually sits on. The contrast maths that
 * turns this into "4.6:1 here, 3.0:1 on this panel" lives in `contrast.ts`
 * and `inspectReadout.ts`; this file is the report and the script that
 * produces it.
 */

/** A colour as the page states it, 0..255 channels and 0..1 alpha. */
export type RGBA = [number, number, number, number]

export interface InspectRect {
  x: number
  y: number
  width: number
  height: number
}

export interface InspectReport {
  tag: string
  id: string
  classes: string
  /** The element's own text, trimmed and bounded, for the readout. */
  text: string
  /** The element's border box, in CSS pixels of the target viewport. */
  rect: InspectRect
  fontSizePx: number
  fontWeight: number
  fontFamily: string
  color: RGBA
  /**
   * The colour the text sits on: the nearest ancestor's opaque background,
   * with any translucent layers between composited onto it, and the
   * viewport's white under a page that paints nothing. Null when an image
   * or gradient is in the way — then nothing here can say what the pixels
   * are, and the readout says so instead of guessing.
   */
  background: RGBA | null
  backgroundNote: 'computed' | 'image'
}

/**
 * The isolated world the script runs in. Not the preload's (Electron's is
 * 999) and not the page's main world: a world of its own can read the DOM
 * and nothing the page defines can shadow `getComputedStyle` under it.
 */
export const INSPECT_WORLD_ID = 7301

/** Longest selector the inspector accepts from an agent or the CLI. */
export const MAX_SELECTOR_LENGTH = 512

/**
 * Runs inside the target page. Self-contained on purpose — it is shipped as
 * source (`INSPECT_SCRIPT`) and evaluated there, so it must reference nothing
 * from this module. `'point'` takes a viewport point; `'selector'` takes a
 * CSS selector and reports its first match (an invalid selector, or one that
 * matches nothing, is null). Returns a plain object the parser on the main
 * side checks field by field; the page is not trusted, its DOM merely
 * measured.
 */
export function inspectTarget(mode: 'point' | 'selector', a: number | string, b?: number): InspectReport | null {
  let el: Element | null = null
  if (mode === 'point') {
    const hit = document.elementFromPoint(Number(a), Number(b))
    el = hit instanceof Element ? hit : null
  } else {
    try {
      el = document.querySelector(String(a))
    } catch {
      el = null
    }
  }
  if (!(el instanceof Element)) return null

  const parseColor = (s: string): RGBA | null => {
    const m = /rgba?\(([^)]+)\)/.exec(s)
    if (!m) return null
    const p = m[1]!.split(/[,/ ]+/).filter(v => v.length > 0).map(v => parseFloat(v))
    if (p.length < 3 || p.slice(0, 3).some(v => !Number.isFinite(v))) return null
    const alpha = p.length > 3 && Number.isFinite(p[3]!) ? p[3]! : 1
    return [p[0]!, p[1]!, p[2]!, alpha]
  }
  const over = (top: RGBA, under: RGBA): RGBA => {
    const alpha = top[3]
    return [
      top[0] * alpha + under[0] * (1 - alpha),
      top[1] * alpha + under[1] * (1 - alpha),
      top[2] * alpha + under[2] * (1 - alpha),
      1,
    ]
  }

  const cs = getComputedStyle(el)
  const color = parseColor(cs.color) ?? [0, 0, 0, 1]

  // Walk up for the first opaque background, remembering translucent layers
  // on the way so they can be composited back down onto it. A background
  // image or gradient anywhere on the way is a stop: the pixels under the
  // text are not a colour anyone stated.
  const layers: RGBA[] = []
  let background: RGBA | null = null
  let note: 'computed' | 'image' = 'computed'
  let node: Element | null = el
  while (node) {
    const s = node === el ? cs : getComputedStyle(node)
    if (s.backgroundImage && s.backgroundImage !== 'none') {
      note = 'image'
      break
    }
    const c = parseColor(s.backgroundColor)
    if (c && c[3] > 0) {
      if (c[3] >= 1) {
        background = c
        break
      }
      layers.push(c)
    }
    node = node.parentElement
  }
  if (note === 'computed') {
    // Nothing opaque all the way up: the viewport is white under it.
    let base: RGBA = background ?? [255, 255, 255, 1]
    for (let i = layers.length - 1; i >= 0; i--) base = over(layers[i]!, base)
    background = base
  } else {
    background = null
  }

  const r = el.getBoundingClientRect()
  const family = cs.fontFamily.split(',')[0]?.replace(/["']/g, '').trim() ?? ''
  return {
    tag: el.tagName.toLowerCase(),
    id: el.id,
    classes: el.getAttribute('class') ?? '',
    text: (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 60),
    rect: { x: r.left, y: r.top, width: r.width, height: r.height },
    fontSizePx: parseFloat(cs.fontSize),
    fontWeight: parseInt(cs.fontWeight, 10) || 400,
    fontFamily: family,
    color,
    background,
    backgroundNote: note,
  }
}

/** The point form, for the browser tests and anything else in-page. */
export function inspectAtPoint(x: number, y: number): InspectReport | null {
  return inspectTarget('point', x, y)
}

/** `inspectTarget` as source, for `executeJavaScriptInIsolatedWorld`. */
export const INSPECT_SCRIPT = `(${inspectTarget.toString()})`
