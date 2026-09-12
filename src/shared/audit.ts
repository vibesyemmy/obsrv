/// <reference lib="dom" />
// The DOM lib is pulled in for this file alone, as in `inspect.ts`: the
// walk is written here so the CLI can ship it as source; nothing in this
// file runs outside the target page except the string.

import { SCROLL_HOST_SCRIPT, clipTest, findScroller, framesInViewport, rootScrolls, scrollOffset, shadowContent } from './scrollHost'

/**
 * The physical-units audit's raw material: every interactive element and
 * every element with text of its own, with their boxes and font sizes as
 * the page lays them out. Measurement only — what is small in millimetres
 * on a given screen is decided afterwards (`cli/audit.ts`), where the
 * screen's density is known.
 */

/** CSS pixels, page coordinates (viewport rect plus the scroll offset). */
export interface AuditRect {
  x: number
  y: number
  width: number
  height: number
  /**
   * Set when a scroll container the page's own scroll does not drive holds
   * this element out of view (`clipTest` in scrollHost.ts). The coordinates
   * above are then still the element's, but they are not a place on the
   * captured page: a sidebar with its own 7,700 px of links puts its later
   * items thousands of px below a document a few thousand tall. The finding
   * is real and stays in the list; nothing may pin by it.
   */
  clipped?: true
}

export interface AuditTarget {
  /** `tag#id.first-class`, for the reader. */
  element: string
  text: string
  rect: AuditRect
}

export interface AuditText {
  element: string
  text: string
  fontSizePx: number
  rect: AuditRect
}

export interface AuditReport {
  viewport: { width: number; height: number }
  pageHeight: number
  targets: AuditTarget[]
  text: AuditText[]
  /** Elements past the caps, counted but not listed. */
  truncated: { targets: number; text: number }
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
   * A value out of bounds costs its own entry, not the page; the judge says
   * how many went, so a systematic fault reads as a number rather than as a
   * quietly thin page.
   */
  dropped?: { targets?: number; text?: number }
}

/** Caps on what one report carries back; a page past them is still summarised. */
export const AUDIT_MAX_TARGETS = 2000
export const AUDIT_MAX_TEXT = 3000

/**
 * Runs inside the target page. Shipped as source (`AUDIT_SCRIPT`) and
 * evaluated there, so it may reference only page globals and the scroll-host
 * helpers `AUDIT_SCRIPT` puts beside it — nothing else from this module. The
 * page is not trusted, its layout merely measured; the parser on the other
 * side checks every field.
 *
 * Targets are the elements a finger is meant to land on: links, form
 * controls, `summary`, the interactive ARIA roles, and anything focusable by
 * `tabindex`. Text is any element with a non-blank text node of its own —
 * the element whose font size the glyphs actually take — skipping what is
 * not rendered: zero boxes, `visibility: hidden`, `opacity: 0`, and a font
 * size of zero, which is the wrapper trick, not text.
 */
export function auditPage(maxTargets: number, maxText: number): AuditReport {
  const label = (el: Element): string => {
    const id = el.id ? `#${el.id}` : ''
    const cls = (el.getAttribute('class') ?? '').split(/\s+/).find(c => c.length > 0)
    return `${el.tagName.toLowerCase()}${id}${cls ? `.${cls}` : ''}`
  }
  const snippet = (s: string): string => s.replace(/\s+/g, ' ').trim().slice(0, 40)
  // The element the capture scrolls — the shell's scroller, or the document
  // when the document is what scrolls. Boxes held out of view by any *other*
  // scroller are marked: their page coordinates are not a place on the page.
  const host = rootScrolls() ? null : findScroller()
  const clipped = clipTest(host)
  // Page coordinates: see `scrollOffset` in scrollHost.ts for why this is not
  // just `window.scrollX`/`scrollY` on an app shell.
  const offset = scrollOffset(host)
  // Rendered, and somewhere a finger or an eye could reach: not a zero box,
  // not hidden, not the 1×1 clipped box of the "visually hidden" pattern
  // (screen-reader text, and controls made accessible that way — measured
  // on real pages, those were the 0.2 mm "targets"), and not parked off the
  // page at a negative offset.
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
  const pageRect = (r: DOMRect, el: Element): AuditRect => {
    const o = offset(el)
    return {
      x: r.left + o.x,
      y: r.top + o.y,
      width: r.width,
      height: r.height,
      ...(clipped(r, el) ? { clipped: true as const } : {}),
    }
  }

  const TARGETS =
    'a[href],button,input:not([type="hidden"]),select,textarea,summary,' +
    '[role="button"],[role="link"],[role="checkbox"],[role="radio"],[role="tab"],[role="menuitem"],[role="switch"],' +
    '[tabindex]:not([tabindex="-1"])'
  const targets: AuditTarget[] = []
  let targetsOver = 0
  // An icon-only link is measured over the icon: the union of its sized
  // children. Its own box is the wrong thing twice over — a block child
  // inside an inline is laid out in an anonymous block that spans the
  // container (measured: 568 px wide for a 10 px arrow in a 600 px box), and
  // with nothing sized inside it can be nothing at all. The finger aims at
  // what is drawn. The anchor's own box stands in only when no child has one.
  const iconBox = (el: Element): DOMRect => {
    let box: DOMRect | null = null
    for (const child of Array.from(el.children)) {
      const c = child.getBoundingClientRect()
      if (!(c.width > 0 && c.height > 0)) continue
      box =
        box === null
          ? c
          : new DOMRect(
              Math.min(box.left, c.left),
              Math.min(box.top, c.top),
              Math.max(box.right, c.right) - Math.min(box.left, c.left),
              Math.max(box.bottom, c.bottom) - Math.min(box.top, c.top),
            )
    }
    return box ?? el.getBoundingClientRect()
  }
  /** What an icon-only control is called: its own label, or the icon's title, label or alt. */
  const iconName = (el: Element): string => {
    const own = el.getAttribute('aria-label') || el.getAttribute('title')
    if (own) return own
    const named = el.querySelector('[aria-label],[title],img[alt]')
    return named ? named.getAttribute('aria-label') || named.getAttribute('title') || named.getAttribute('alt') || '' : ''
  }
  for (const el of Array.from(document.querySelectorAll(TARGETS))) {
    const cs = getComputedStyle(el)
    // A link inside running text is as tall as its line and flagged on every
    // page there is; WCAG 2.5.8 exempts inline links for that reason, and so
    // does this — when the link *is* text. An inline anchor with no text of
    // its own around a sized child (HN's upvote: a 10×10 block arrow inside
    // an inline `a`) is a control drawn as an icon, and is measured as one.
    // A link styled as a control (block, inline-block, flex) is a target like
    // any other.
    const inlineLink = el.tagName === 'A' && cs.display === 'inline'
    const iconOnly = inlineLink && (el.textContent ?? '').trim().length === 0
    if (inlineLink && !iconOnly) continue
    const r = iconOnly ? iconBox(el) : el.getBoundingClientRect()
    if (!shown(cs, r, el)) continue
    if (targets.length >= maxTargets) {
      targetsOver++
      continue
    }
    const value = el instanceof HTMLInputElement ? el.value : ''
    targets.push({
      element: label(el),
      // Any target with no text of its own is named by its icon's title, label
      // or alt — not only the icon-only inline ones: HN's upvote on the phone
      // layout is a block anchor around the same arrow, and was named "".
      text: snippet(el.textContent || value || iconName(el) || ''),
      rect: pageRect(r, el),
    })
  }

  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TITLE', 'HEAD', 'META', 'LINK'])
  const text: AuditText[] = []
  let textOver = 0
  const root = document.body ?? document.documentElement
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT)
  for (let node: Node | null = walker.currentNode; node; node = walker.nextNode()) {
    const el = node as Element
    if (SKIP.has(el.tagName)) continue
    let own = ''
    for (const child of Array.from(el.childNodes)) if (child.nodeType === 3) own += child.textContent ?? ''
    if (own.trim().length === 0) continue
    const cs = getComputedStyle(el)
    const r = el.getBoundingClientRect()
    if (!shown(cs, r, el)) continue
    const fontSizePx = parseFloat(cs.fontSize)
    if (!(fontSizePx > 0)) continue
    if (text.length >= maxText) {
      textOver++
      continue
    }
    text.push({ element: label(el), text: snippet(own), fontSizePx, rect: pageRect(r, el) })
  }

  return {
    viewport: { width: innerWidth, height: innerHeight },
    // See lint.ts: an app shell's document is exactly the viewport while its
    // content, and so its findings, run far below.
    pageHeight: Math.ceil(
      Math.max(
        document.documentElement.scrollHeight,
        document.body ? document.body.scrollHeight : 0,
        // Clipped rects are excluded on purpose: they measure how far a
        // panel's content runs, not how tall the page is, and letting them in
        // made `pageHeight` 7,741 on a tailwindcss.com/docs page 2,591 tall.
        ...targets.filter(t => !t.rect.clipped).map(t => t.rect.y + t.rect.height),
        ...text.filter(t => !t.rect.clipped).map(t => t.rect.y + t.rect.height),
      ),
    ),
    frames: framesInViewport(),
    shadow: shadowContent(),
    targets,
    text,
    truncated: { targets: targetsOver, text: textOver },
  }
}

/** `auditPage` as source, for `executeJavaScriptInIsolatedWorld`. */
export const AUDIT_SCRIPT = `(() => {\n${SCROLL_HOST_SCRIPT}\n return (${auditPage.toString()})\n})()`
