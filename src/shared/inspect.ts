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

import { SHADOW_TREE_SCRIPT, shadowElementFromPoint, shadowParent, shadowStackFrom } from './scrollHost'

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
  /**
   * The element's effective `opacity` — the product down its ancestor chain,
   * 1 when nothing sets it. Separate from the colour's own alpha, which is in
   * `color`; a page can use both and they multiply.
   */
  opacity: number
  /**
   * Which rule takes the element off the screen, or null when it is drawn.
   * `opacity: 0` is deliberately not here: it is already said through the
   * painted colour, which reports what the screen shows.
   */
  hidden: 'visibility' | 'display' | null
  /**
   * The layout viewport's width, in the page's own CSS px. A page with no
   * viewport meta tag under a phone preset lays out 980 wide and is drawn
   * scaled to fit, so the box and the font above are larger than they are
   * on the glass; the readout compares this with the screen to say by how much.
   * Optional so a report from before the field reads as scale 1.
   */
  viewportWidth?: number
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
export function inspectTarget(mode: 'point' | 'selector', a: number | string, b?: number): InspectReport | { invalidSelector: true } | null {
  let el: Element | null = null
  if (mode === 'point') {
    // Through open shadow roots: the element drawn at the point, not the
    // component's host (`shadowElementFromPoint`).
    const hit = shadowElementFromPoint(Number(a), Number(b))
    el = hit instanceof Element ? hit : null
  } else {
    // A selector keeps the light DOM's meaning, as `document.querySelector`
    // gives it: it does not pierce a shadow root. A point does.
    try {
      el = document.querySelector(String(a))
    } catch {
      // A selector that is not CSS and a selector that matches nothing used to
      // return the same `null`, so `p[` and `#no-such-thing` answered
      // identically down to the human line — an agent that typos a selector
      // concluded the element was not on the page. The marker is returned
      // rather than thrown so it survives the page boundary, and the parser
      // keeps it.
      return { invalidSelector: true }
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

  // The element's EFFECTIVE opacity: the product down its ancestor chain,
  // because `opacity` composites a whole subtree and a parent's .5 greys its
  // children whatever they declare. It is not in the colour — computed
  // `color` stays #ffffff under `opacity: .62` — so it has to be gathered
  // here or it reaches nothing: before this, text greyed that way was judged
  // as though it were white (docs/research/2026-09-15-contrast-figure.md).
  let opacity = 1
  for (let node: Element | null = el; node !== null; node = shadowParent(node)) {
    const o = Number.parseFloat(getComputedStyle(node).opacity)
    if (Number.isFinite(o)) opacity *= Math.min(1, Math.max(0, o))
  }

  // Whether the thing measured is on the screen at all, and if not, which rule
  // takes it off. `audit` already answers this — `shown` in shared/audit.ts —
  // and skips what is not rendered, so on one page `audit` reported the
  // smallest text as 10 px while `inspect` measured a 4 px paragraph and said
  // nothing about it being invisible. Both were right about their own
  // question; only one said what it did. `opacity: 0` is already reported
  // through the painted colour and is left to it.
  //
  // **The two rules are not the same shape, and treating them as one was a
  // bug** (found by the 0.61.0 release sweep — a classifier's read of #85,
  // confirmed by Wren and Henry reading the code; `bug-inspect-visible-child-not-drawn`).
  // `visibility` is inherited *and
  // overridable*: a descendant may declare `visibility: visible` under a
  // hidden ancestor and IS painted. Its own computed value already carries the
  // inheritance, so reading the element alone is both necessary and
  // sufficient — walking ancestors found the hidden parent and called a
  // visible child undrawn, which is the opposite of true. `display: none` is
  // not overridable that way: nothing inside an undisplayed box is rendered
  // whatever it declares, and the child's own computed `display` does not say
  // so, which is why that one still walks.
  //
  // Reading `visibility` on the element alone is also what `audit`'s `shown`
  // does (`shared/audit.ts`), which is the agreement the note was added to
  // deliver in the first place.
  let hidden: 'visibility' | 'display' | null = null
  const own = getComputedStyle(el)
  if (own.visibility === 'hidden' || own.visibility === 'collapse') hidden = 'visibility'
  if (hidden === null) {
    for (let node: Element | null = el; node !== null; node = shadowParent(node)) {
      if (getComputedStyle(node).display === 'none') {
        hidden = 'display'
        break
      }
    }
  }

  const r = el.getBoundingClientRect()
  // What is painted under the text: the stack at a point inside its box,
  // top to bottom, from the element itself down. The first opaque
  // background in that stack is what someone sees, with the translucent
  // layers above it composited on; a background image or gradient, or an
  // image element, on the way is a stop — the pixels there are not a colour
  // anyone stated. Ancestors are in the stack, and so is a fixed scrim from
  // another branch of the tree, which a walk up the ancestors never met:
  // lemonde.fr's "Reject all cookies" in #eff0f3 on a dark scrim was judged
  // on the body's white and failed at 1.14:1. Off the viewport the stack is
  // empty, and the walk up the ancestors stands in.
  const PAINTED = new Set(['IMG', 'VIDEO', 'CANVAS', 'PICTURE', 'SVG', 'IFRAME', 'OBJECT', 'EMBED'])
  const stackUnder = (): Element[] | null => {
    const x = r.left + r.width / 2
    const y = r.top + r.height / 2
    if (!(r.width > 0 && r.height > 0) || x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return null
    // Across shadow boundaries: the component's own backgrounds, then the
    // page's under it (`shadowStackFrom`).
    return shadowStackFrom(el, x, y)
  }
  const ancestors = (): Element[] => {
    const chain: Element[] = []
    for (let node: Element | null = el; node; node = shadowParent(node)) chain.push(node)
    return chain
  }
  const layers: RGBA[] = []
  let background: RGBA | null = null
  let note: 'computed' | 'image' = 'computed'
  for (const node of stackUnder() ?? ancestors()) {
    if (node !== el && PAINTED.has(node.tagName.toUpperCase())) {
      note = 'image'
      break
    }
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
  }
  if (note === 'computed') {
    // Nothing opaque all the way down: the viewport is white under it.
    let base: RGBA = background ?? [255, 255, 255, 1]
    for (let i = layers.length - 1; i >= 0; i--) base = over(layers[i]!, base)
    background = base
  } else {
    background = null
  }

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
    opacity,
    hidden,
    viewportWidth: innerWidth,
  }
}

/** The point form, for the browser tests and anything else in-page. */
export function inspectAtPoint(x: number, y: number): InspectReport | null {
  const r = inspectTarget('point', x, y)
  // A point cannot produce the invalid-selector marker; narrowed for callers.
  return r !== null && 'invalidSelector' in r ? null : r
}

/**
 * `inspectTarget` as source, for `executeJavaScriptInIsolatedWorld`, with the
 * shadow-tree helpers it calls beside it.
 */
export const INSPECT_SCRIPT = `(() => {\n${SHADOW_TREE_SCRIPT}\n return (${inspectTarget.toString()})\n})()`
