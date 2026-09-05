import type { RGBA } from './inspect'

/**
 * The lint's page walk: one pass over the rendered DOM that brings back
 * everything the rules in `cli/lint.ts` judge — text with the colours it is
 * actually drawn in, edges thin enough to be in question on the screen in
 * force, and raster images with their natural and drawn sizes. The walk
 * collects; the rules decide, outside the page, where the screen's density
 * and the panel profile are known. Self-contained on purpose, like the
 * audit's and the inspector's: it is shipped as source into an isolated
 * world of the target, so nothing here may reach outside the function.
 */

export interface LintRect {
  x: number
  y: number
  width: number
  height: number
}

export interface LintText {
  /** `tag#id.first-class`, for the reader. */
  element: string
  text: string
  /** Border box in page CSS px (scroll included), like an audit finding's. */
  rect: LintRect
  fontSizePx: number
  fontWeight: number
  fontFamily: string
  color: RGBA
  /**
   * The colour under the text, composited down from the nearest opaque
   * ancestor; null when an image or gradient is in the way, in which case
   * no rule here can say what the pixels are.
   */
  background: RGBA | null
  backgroundNote: 'computed' | 'image'
}

export type LintEdgeKind = 'border-top' | 'border-right' | 'border-bottom' | 'border-left' | 'outline' | 'box-shadow' | 'height' | 'width'

export interface LintEdge {
  element: string
  text: string
  rect: LintRect
  kind: LintEdgeKind
  /** The edge's thickness in CSS px as computed; always under the walk's threshold. */
  px: number
}

export interface LintImage {
  element: string
  rect: LintRect
  naturalWidth: number
  naturalHeight: number
  /** What Chromium chose to load, bounded; a data URL is cut at its media type. */
  src: string
  srcset: boolean
  /** The srcset descriptors as written, e.g. `['1x', '2x']` or `['400w', '800w']`. */
  candidates: string[]
}

export interface LintReport {
  viewport: { width: number; height: number }
  pageHeight: number
  text: LintText[]
  edges: LintEdge[]
  images: LintImage[]
  /** Entries past the caps, counted but not listed. */
  truncated: { text: number; edges: number; images: number }
}

/** Caps on what one report carries back; a page past them is still summarised. */
export const LINT_MAX_TEXT = 3000
export const LINT_MAX_EDGES = 2000
export const LINT_MAX_IMAGES = 500

/**
 * Walks the page. `edgeBelowPx` is the CSS thickness under which an edge is
 * worth carrying back — the caller passes one device pixel expressed in CSS
 * px for the screen in force (`1 / (density × text scale)`), so a border
 * that is a whole pixel on this screen is not reported at all.
 */
export function lintPage(edgeBelowPx: number, maxText: number, maxEdges: number, maxImages: number): LintReport {
  const label = (el: Element): string => {
    const id = el.id ? `#${el.id}` : ''
    const cls = (el.getAttribute('class') ?? '').split(/\s+/).find(c => c.length > 0)
    return `${el.tagName.toLowerCase()}${id}${cls ? `.${cls}` : ''}`
  }
  const snippet = (s: string): string => s.replace(/\s+/g, ' ').trim().slice(0, 40)
  // Rendered and somewhere an eye could reach: the audit's rule, kept in step.
  const shown = (cs: CSSStyleDeclaration, r: DOMRect): boolean =>
    r.width > 0 &&
    r.height > 0 &&
    !(r.width <= 1 && r.height <= 1) &&
    r.right + scrollX > 0 &&
    r.bottom + scrollY > 0 &&
    cs.visibility !== 'hidden' &&
    cs.display !== 'none' &&
    cs.opacity !== '0'
  const pageRect = (r: DOMRect): LintRect => ({ x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height })

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
  // The inspector's walk: up to the first opaque background, compositing
  // translucent layers back down onto it; an image or gradient on the way
  // is a stop, and nothing opaque all the way up means the viewport's white.
  const backgroundOf = (el: Element, cs: CSSStyleDeclaration): { background: RGBA | null; note: 'computed' | 'image' } => {
    const layers: RGBA[] = []
    let node: Element | null = el
    while (node) {
      const s = node === el ? cs : getComputedStyle(node)
      if (s.backgroundImage && s.backgroundImage !== 'none') return { background: null, note: 'image' }
      const c = parseColor(s.backgroundColor)
      if (c && c[3] > 0) {
        if (c[3] >= 1) {
          let base: RGBA = c
          for (let i = layers.length - 1; i >= 0; i--) base = over(layers[i]!, base)
          return { background: base, note: 'computed' }
        }
        layers.push(c)
      }
      node = node.parentElement
    }
    let base: RGBA = [255, 255, 255, 1]
    for (let i = layers.length - 1; i >= 0; i--) base = over(layers[i]!, base)
    return { background: base, note: 'computed' }
  }

  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TITLE', 'HEAD', 'META', 'LINK'])
  const text: LintText[] = []
  const edges: LintEdge[] = []
  const images: LintImage[] = []
  let textOver = 0
  let edgesOver = 0
  let imagesOver = 0

  const root = document.body ?? document.documentElement
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT)
  for (let node: Node | null = walker.currentNode; node; node = walker.nextNode()) {
    const el = node as Element
    if (SKIP.has(el.tagName)) continue
    const cs = getComputedStyle(el)
    const r = el.getBoundingClientRect()
    if (!shown(cs, r)) continue
    const rect = pageRect(r)

    // Text of the element's own.
    let own = ''
    for (const child of Array.from(el.childNodes)) if (child.nodeType === 3) own += child.textContent ?? ''
    if (own.trim().length > 0) {
      const fontSizePx = parseFloat(cs.fontSize)
      if (fontSizePx > 0) {
        if (text.length >= maxText) {
          textOver++
        } else {
          const bg = backgroundOf(el, cs)
          text.push({
            element: label(el),
            text: snippet(own),
            rect,
            fontSizePx,
            fontWeight: parseInt(cs.fontWeight, 10) || 400,
            fontFamily: cs.fontFamily.split(',')[0]?.replace(/["']/g, '').trim() ?? '',
            color: parseColor(cs.color) ?? [0, 0, 0, 1],
            background: bg.background,
            backgroundNote: bg.note,
          })
        }
      }
    }

    // Edges thinner than the threshold: painted borders, an outline, a
    // box-shadow used as a hairline (no blur, every length under a pixel),
    // and a painted element whose own extent is the line.
    const edge = (kind: LintEdgeKind, px: number): void => {
      if (!(px > 0) || px >= edgeBelowPx) return
      if (edges.length >= maxEdges) {
        edgesOver++
        return
      }
      edges.push({ element: label(el), text: snippet(el.textContent ?? ''), rect, kind, px })
    }
    const sides: [LintEdgeKind, string, string, string][] = [
      ['border-top', cs.borderTopStyle, cs.borderTopWidth, cs.borderTopColor],
      ['border-right', cs.borderRightStyle, cs.borderRightWidth, cs.borderRightColor],
      ['border-bottom', cs.borderBottomStyle, cs.borderBottomWidth, cs.borderBottomColor],
      ['border-left', cs.borderLeftStyle, cs.borderLeftWidth, cs.borderLeftColor],
    ]
    for (const [kind, style, width, color] of sides) {
      if (style === 'none' || style === 'hidden') continue
      const c = parseColor(color)
      if (!c || c[3] === 0) continue
      edge(kind, parseFloat(width))
    }
    if (cs.outlineStyle !== 'none') {
      const c = parseColor(cs.outlineColor)
      if (c && c[3] > 0) edge('outline', parseFloat(cs.outlineWidth))
    }
    if (cs.boxShadow && cs.boxShadow !== 'none') {
      // Computed form: "rgb(…) ox oy blur spread [inset]", comma-separated.
      for (const shadow of cs.boxShadow.split(/,(?![^(]*\))/)) {
        const lengths = (shadow.match(/-?\d*\.?\d+px/g) ?? []).map(v => Math.abs(parseFloat(v)))
        if (lengths.length < 3 || lengths[2]! > 0) continue
        const max = Math.max(lengths[0]!, lengths[1]!, lengths[3] ?? 0)
        if (max > 0) edge('box-shadow', max)
      }
    }
    const bgc = parseColor(cs.backgroundColor)
    const painted = (bgc !== null && bgc[3] > 0) || el.tagName === 'HR' || (cs.backgroundImage !== '' && cs.backgroundImage !== 'none')
    if (painted) {
      if (r.height < edgeBelowPx && r.width >= 8) edge('height', r.height)
      if (r.width < edgeBelowPx && r.height >= 8) edge('width', r.width)
    }

    // Raster images: natural against drawn size is the rules' business.
    if (el instanceof HTMLImageElement && el.naturalWidth > 0 && el.naturalHeight > 0) {
      if (images.length >= maxImages) {
        imagesOver++
      } else {
        const srcset = el.getAttribute('srcset') ?? ''
        const candidates = srcset
          .split(',')
          .map(c => c.trim().split(/\s+/)[1] ?? '')
          .filter(c => c.length > 0)
          .slice(0, 12)
        const chosen = el.currentSrc || el.src || ''
        const src = chosen.startsWith('data:') ? chosen.slice(0, Math.min(chosen.indexOf(',') + 1 || 40, 40)) : chosen.slice(0, 200)
        images.push({ element: label(el), rect, naturalWidth: el.naturalWidth, naturalHeight: el.naturalHeight, src, srcset: srcset.length > 0, candidates })
      }
    }
  }

  return {
    viewport: { width: innerWidth, height: innerHeight },
    pageHeight: Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0),
    text,
    edges,
    images,
    truncated: { text: textOver, edges: edgesOver, images: imagesOver },
  }
}

/** `lintPage` as source, for `executeJavaScriptInIsolatedWorld`. */
export const LINT_SCRIPT = `(${lintPage.toString()})`
