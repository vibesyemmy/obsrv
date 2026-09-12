import type { RGBA } from './inspect'


import { SCROLL_HOST_SCRIPT, clipTest, findScroller, framesInViewport, rootScrolls, scrollOffset, shadowContent } from './scrollHost'

/**
 * The lint's page walk: one pass over the rendered DOM that brings back
 * everything the rules in `cli/lint.ts` judge — text with the colours it is
 * actually drawn in, edges thin enough to be in question on the screen in
 * force, and raster images with their natural and drawn sizes. The walk
 * collects; the rules decide, outside the page, where the screen's density
 * and the panel profile are known. Shipped as source into an isolated world
 * of the target, like the audit's and the inspector's, so the walk may reach
 * only page globals and the scroll-host helpers `LINT_SCRIPT` puts beside it.
 */

export interface LintRect {
  x: number
  y: number
  width: number
  height: number
  /** See `AuditRect.clipped`: page coordinates that are not a place on the page. */
  clipped?: true
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
  /**
   * The loaded file's own pixels. Not the element's `naturalWidth`: with a
   * srcset that is density-corrected (the chosen candidate's pixels over its
   * density — the CSS size it is meant for), which on a 2x screen would make
   * every responsive image read as upscaled 2×. Probed by loading the chosen
   * URL as a plain image, from cache.
   */
  naturalWidth: number
  naturalHeight: number
  /** What Chromium chose to load, bounded; a data URL is cut at its media type. */
  src: string
  /** The img has a srcset, or sits in a <picture> whose <source> has one. */
  srcset: boolean
  /** The srcset descriptors as written, e.g. `['1x', '2x']` or `['400w', '800w']`. */
  candidates: string[]
  /** The descriptor of the candidate Chromium chose (`'640w'`, `'2x'`), when it can be matched. */
  chosen?: string
  /**
   * How the file is fitted into its box (`object-fit`). A file covering a
   * box of another shape is scaled by its larger axis, one fitted inside by
   * its smaller, and one filling it is stretched by each axis separately —
   * so the width alone says nothing about how blurred it is. Absent from an
   * older app's reply, in which case `fill` is assumed.
   */
  objectFit?: LintObjectFit
}

export type LintObjectFit = 'fill' | 'contain' | 'cover' | 'none' | 'scale-down'
export const LINT_OBJECT_FITS: readonly LintObjectFit[] = ['fill', 'contain', 'cover', 'none', 'scale-down']

export interface LintReport {
  viewport: { width: number; height: number }
  pageHeight: number
  text: LintText[]
  edges: LintEdge[]
  images: LintImage[]
  /** Entries past the caps, counted but not listed. */
  truncated: { text: number; edges: number; images: number }
  /**
   * Raster files of a pixel or two on a side — 1×1 GIFs stretched into gaps,
   * the spacers of a table layout — counted here and never judged: nothing
   * about a spacer is blurred, and paulgraham.com's desktop page put 332 of
   * them in the upscaled rule and 206 more past the image cap. A tiny file a
   * lazy loader is still to fill (`loading="lazy"`, a `data-src`, a `srcset`)
   * is a placeholder, not a spacer, and stays in the rules. Absent from an
   * older app's reply, which counted none.
   */
  spacers?: number
  /**
   * The iframes in the viewport at the page's top and how much of it they
   * cover, for the sentence a report with nothing in it carries: the
   * measurement does not enter iframes, and a bot wall is one over the whole
   * viewport. Absent from an older app's reply.
   */
  frames?: { count: number; viewportCoverage: number }
  /**
   * What the open shadow roots hold that this measurement did not enter
   * (`shadowContent`). A page built from web components measures as nothing;
   * this is how the answer says so instead of guessing.
   */
  shadow?: { hosts: number; interactive: number; text: number }
  /**
   * How many entries the checks refused, by kind — absent when none were.
   * See `AuditReport.dropped`: the entry goes, not the page, and the judge
   * says how many and of what kind.
   */
  dropped?: { text?: number; edges?: number; images?: number }
}

/** A raster this small on either side is a spacer, not a picture. */
export const LINT_SPACER_MAX_PX = 2

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
export async function lintPage(edgeBelowPx: number, maxText: number, maxEdges: number, maxImages: number): Promise<LintReport> {
  const label = (el: Element): string => {
    const id = el.id ? `#${el.id}` : ''
    const cls = (el.getAttribute('class') ?? '').split(/\s+/).find(c => c.length > 0)
    return `${el.tagName.toLowerCase()}${id}${cls ? `.${cls}` : ''}`
  }
  const snippet = (s: string): string => s.replace(/\s+/g, ' ').trim().slice(0, 40)
  // See audit.ts: the element the capture scrolls, and boxes some *other*
  // scroller holds out of view have coordinates that are the element's, not
  // a place on the page.
  const host = rootScrolls() ? null : findScroller()
  const clipped = clipTest(host)
  // Page coordinates: see `scrollOffset` in scrollHost.ts.
  const offset = scrollOffset(host)
  // Rendered and somewhere an eye could reach: the audit's rule, kept in step.
  const shown = (cs: CSSStyleDeclaration, r: DOMRect, el: Element): boolean => {
    const o = offset(el)
    return (
      r.width > 0 &&
      r.height > 0 &&
      !(r.width <= 1 && r.height <= 1) &&
      r.right + o.x > 0 &&
      r.bottom + o.y > 0 &&
      cs.visibility !== 'hidden' &&
      cs.display !== 'none' &&
      cs.opacity !== '0'
    )
  }
  const pageRect = (r: DOMRect, el: Element): LintRect => {
    const o = offset(el)
    return {
      x: r.left + o.x,
      y: r.top + o.y,
      width: r.width,
      height: r.height,
      ...(clipped(r, el) ? { clipped: true as const } : {}),
    }
  }

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
  // The inspector's rule (shared/inspect.ts): what is painted under the text
  // is the stack at a point inside its box, from the element down — the
  // first opaque background there, with the translucent layers above it
  // composited on; an image or gradient, or an image element, on the way is
  // a stop. Ancestors are in the stack, and so is a fixed scrim from another
  // branch of the tree, which a walk up the ancestors never met. Off the
  // viewport the stack is empty and the ancestors stand in.
  const PAINTED = new Set(['IMG', 'VIDEO', 'CANVAS', 'PICTURE', 'SVG', 'IFRAME', 'OBJECT', 'EMBED'])
  const backgroundOf = (el: Element, cs: CSSStyleDeclaration, r: DOMRect): { background: RGBA | null; note: 'computed' | 'image' } => {
    let under: Element[] | null = null
    const x = r.left + r.width / 2
    const y = r.top + r.height / 2
    if (r.width > 0 && r.height > 0 && x >= 0 && y >= 0 && x < innerWidth && y < innerHeight) {
      const stack = document.elementsFromPoint(x, y)
      const at = stack.indexOf(el)
      if (at >= 0) under = stack.slice(at)
    }
    if (under === null) {
      under = []
      for (let node: Element | null = el; node; node = node.parentElement) under.push(node)
    }
    const layers: RGBA[] = []
    for (const node of under) {
      if (node !== el && PAINTED.has(node.tagName.toUpperCase())) return { background: null, note: 'image' }
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
    }
    let base: RGBA = [255, 255, 255, 1]
    for (let i = layers.length - 1; i >= 0; i--) base = over(layers[i]!, base)
    return { background: base, note: 'computed' }
  }

  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TITLE', 'HEAD', 'META', 'LINK'])
  const text: LintText[] = []
  const edges: LintEdge[] = []
  const images: LintImage[] = []
  /** Images whose file pixels must be probed after the walk (see below). */
  const probes: Array<{ at: number; url: string }> = []
  let textOver = 0
  let edgesOver = 0
  let imagesOver = 0
  let spacers = 0

  const root = document.body ?? document.documentElement
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT)
  for (let node: Node | null = walker.currentNode; node; node = walker.nextNode()) {
    const el = node as Element
    if (SKIP.has(el.tagName)) continue
    const cs = getComputedStyle(el)
    const r = el.getBoundingClientRect()
    if (!shown(cs, r, el)) continue
    const rect = pageRect(r, el)

    // Text of the element's own.
    let own = ''
    for (const child of Array.from(el.childNodes)) if (child.nodeType === 3) own += child.textContent ?? ''
    if (own.trim().length > 0) {
      const fontSizePx = parseFloat(cs.fontSize)
      if (fontSizePx > 0) {
        if (text.length >= maxText) {
          textOver++
        } else {
          const bg = backgroundOf(el, cs, r)
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

    // Raster images: natural against drawn size is the rules' business —
    // except a file of a pixel or two on a side (LINT_SPACER_MAX_PX, inlined
    // since this function ships as source), which is a spacer stretched into
    // a gap, not a picture: counted, never judged, never on the cap. Unless a
    // lazy loader is still to fill it (`loading="lazy"`, a `data-src`, a
    // `srcset`): that 1×1 is a placeholder, and reading it as an upscale is
    // how `--no-walk` shows a page as it first ships and the walk note names
    // images below the height it reached.
    if (el instanceof HTMLImageElement && el.naturalWidth > 0 && el.naturalHeight > 0) {
      const lazyLike =
        el.loading === 'lazy' ||
        el.hasAttribute('srcset') ||
        Array.from(el.attributes).some(a => a.name.startsWith('data-') && /src|lazy|original/.test(a.name))
      if (Math.min(el.naturalWidth, el.naturalHeight) <= 2 && !lazyLike) {
        spacers++
      } else if (images.length >= maxImages) {
        imagesOver++
      } else {
        // The candidates the page offered: the img's own srcset and, inside a
        // <picture>, each <source>'s. A srcset is "url descriptor, url
        // descriptor"; split on whitespace, since a data URL carries a comma.
        // The comma that ends a candidate needs no space after it, though, so
        // a descriptor can arrive with the next URL glued on ("60w,https://…").
        // Only a token that is a descriptor followed by a comma is split, so
        // the commas inside a data URL are still left alone.
        const parseSet = (set: string): Array<[string, string]> => {
          const out: Array<[string, string]> = []
          const tokens: string[] = []
          for (const token of set.trim().split(/\s+/)) {
            if (token.length === 0) continue
            const glued = /^(\d+(?:\.\d+)?[wx]),(.+)$/.exec(token)
            if (glued) tokens.push(glued[1]!, glued[2]!)
            else tokens.push(token)
          }
          for (let i = 0; i < tokens.length; i++) {
            let url = tokens[i]!
            if (url.endsWith(',')) {
              out.push([url.replace(/,+$/, ''), ''])
              continue
            }
            let descriptor = ''
            if (i + 1 < tokens.length) {
              descriptor = tokens[++i]!.replace(/,+$/, '')
            }
            url = url.replace(/,+$/, '')
            if (url.length > 0) out.push([url, descriptor])
          }
          return out
        }
        const sets: Array<Array<[string, string]>> = []
        const own = el.getAttribute('srcset') ?? ''
        if (own.trim().length > 0) sets.push(parseSet(own))
        const picture = el.parentElement
        if (picture && picture.tagName === 'PICTURE') {
          for (const source of Array.from(picture.querySelectorAll('source'))) {
            const s = source.getAttribute('srcset') ?? ''
            if (s.trim().length > 0) sets.push(parseSet(s))
          }
        }
        const chosenUrl = el.currentSrc || el.src || ''
        const resolve = (u: string): string => {
          try {
            return new URL(u, document.baseURI).href
          } catch {
            return u
          }
        }
        let chosen: string | undefined
        let from: Array<[string, string]> | undefined
        for (const set of sets) {
          const hit = set.find(([u]) => resolve(u) === chosenUrl)
          if (hit) {
            chosen = hit[1] || '1x'
            from = set
            break
          }
        }
        const candidates = (from ?? sets[0] ?? [])
          .map(([, d]) => d)
          .filter(d => d.length > 0)
          .slice(0, 12)
        const src = chosenUrl.startsWith('data:') ? chosenUrl.slice(0, Math.min(chosenUrl.indexOf(',') + 1 || 40, 40)) : chosenUrl.slice(0, 200)
        if (sets.length > 0 && chosenUrl.length > 0) probes.push({ at: images.length, url: chosenUrl })
        // `object-fit` decides which axis the scaling follows; anything but
        // the five keywords (a page-side alias, an empty string) reads as fill.
        const fit = cs.objectFit
        const objectFit = fit === 'contain' || fit === 'cover' || fit === 'none' || fit === 'scale-down' ? fit : 'fill'
        images.push({
          element: label(el),
          rect,
          naturalWidth: el.naturalWidth,
          naturalHeight: el.naturalHeight,
          src,
          srcset: sets.length > 0,
          candidates,
          ...(chosen !== undefined ? { chosen } : {}),
          objectFit,
        })
      }
    }
  }

  // With a srcset, Chromium's naturalWidth is density-corrected: the chosen
  // candidate's pixels over its density, which is the CSS size it is meant
  // for — so on a 2x screen every responsive image would read as upscaled 2×.
  // The file's own pixels come from loading the chosen URL as a plain image
  // (no srcset, density 1), which the cache answers.
  await Promise.all(
    probes.map(async ({ at, url }) => {
      const probe = new Image()
      const loaded = new Promise<boolean>(resolve => {
        probe.onload = () => resolve(true)
        probe.onerror = () => resolve(false)
      })
      probe.src = url
      const ok = await Promise.race([loaded, new Promise<boolean>(resolve => setTimeout(() => resolve(false), 2000))])
      if (ok && probe.naturalWidth > 0 && probe.naturalHeight > 0) {
        images[at]!.naturalWidth = probe.naturalWidth
        images[at]!.naturalHeight = probe.naturalHeight
      }
    }),
  )

  return {
    viewport: { width: innerWidth, height: innerHeight },
    // The document's own height understates an app shell, whose content
    // lives in an inner scroller: the document is exactly the viewport while
    // findings sit far below it. Take the deepest thing actually measured
    // too, so `pageHeight` can never contradict a finding's own rect.
    pageHeight: Math.ceil(
      Math.max(
        document.documentElement.scrollHeight,
        document.body ? document.body.scrollHeight : 0,
        // Clipped rects sit out: they say how far a panel's own content runs,
        // not how tall the page is (see audit.ts).
        ...text.filter(t => !t.rect.clipped).map(t => t.rect.y + t.rect.height),
        ...edges.filter(e => !e.rect.clipped).map(e => e.rect.y + e.rect.height),
        ...images.filter(i => !i.rect.clipped).map(i => i.rect.y + i.rect.height),
      ),
    ),
    frames: framesInViewport(),
    shadow: shadowContent(),
    text,
    edges,
    images,
    truncated: { text: textOver, edges: edgesOver, images: imagesOver },
    spacers,
  }
}

/** `lintPage` as source, for `executeJavaScriptInIsolatedWorld`. */
export const LINT_SCRIPT = `(() => {\n${SCROLL_HOST_SCRIPT}\n return (${lintPage.toString()})\n})()`
