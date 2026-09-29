/// <reference lib="dom" />
// The DOM lib is pulled in for this file alone, as in `audit.ts` and
// `inspect.ts`: the search is written here so the CLI/main can ship it as
// source (`OBSERVE_SCRIPT`); nothing in this file runs outside the target
// page except the string.

import { SCROLL_HOST_SCRIPT, clipTest, findScroller, framesInViewport, rootScrolls, scrollOffset, shadowElements } from './scrollHost'

/**
 * The exact-text reader's raw material (`board/feat-flow-observations.md`,
 * the second PR on that card): for each string a QA engineer stated, what
 * rendered elements on the page in front contain it, and what does not
 * render but is present in the DOM anyway. Measurement only — a flow step
 * turns this into `present`/`absent`/`unknown` (`src/mcp/flowRunner.ts`);
 * this module just reports what is there.
 */

/** CSS pixels, page coordinates (viewport rect plus the scroll offset) —
 *  the same convention `AuditRect` uses, minus `clipped`: a clipped match is
 *  still a rendered one for this reader's purposes, so nothing here needs
 *  the QA engineer to know a sidebar has its own scroller. */
export interface ObserveRect {
  x: number
  y: number
  width: number
  height: number
}

export interface ObserveMatch {
  /** `tag#id.first-class`, for the reader — same convention as `AuditTarget.element`. */
  element: string
  rect: ObserveRect
}

export interface ObserveFinding {
  /** The text the QA engineer stated, verbatim — matching is case-sensitive,
   *  exact substring: their own wording is what they typed, and a fuzzy
   *  match would be answering a different question than the one asked. */
  text: string
  /** How many elements whose OWN text (not an ancestor's — see `observePage`)
   *  contains it are rendered: not `display: none`, not zero-size, not fully
   *  transparent, not the 1×1 "visually hidden" pattern. */
  renderedCount: number
  /** The first of those, in document order, up to `OBSERVE_MAX_MATCHES`. */
  matches: ObserveMatch[]
  /** Elements whose own text contains it but are NOT rendered by the rule
   *  above — present in the DOM, not something a person looking at the
   *  screen would see. Counted and listed separately, never folded into
   *  `renderedCount`: a toast that exists in markup but never actually
   *  appeared is a different fact from one that did. */
  unrenderedCount: number
  /** The first of those, up to `OBSERVE_MAX_UNRENDERED`. */
  unrendered: ObserveMatch[]
}

export interface ObserveReport {
  viewport: { width: number; height: number }
  findings: ObserveFinding[]
  /** Matches or unrendered entries past a text's own cap, summed across
   *  every stated text — absent when nothing was cut. Read the way
   *  `AuditReport.truncated` is: a page past the bound is still summarised,
   *  never dropped for it. `renderedCount`/`unrenderedCount` are exact
   *  either way; only the listed examples are capped. */
  truncated: { matches: number; unrendered: number }
  /**
   * The iframes in the viewport at the page's top and how much of it they
   * cover — this reader never enters a frame, so a string that exists only
   * inside one always reads as zero above. Same shape and source as
   * `AuditReport.frames`; absent from an older app's reply.
   */
  frames?: { count: number; viewportCoverage: number }
}

/** Caps on what one finding carries back; a page past them is still summarised. */
export const OBSERVE_MAX_MATCHES = 20
export const OBSERVE_MAX_UNRENDERED = 20
/** Longest stated text this reader will search for; matches the flow
 *  validator's own tolerance (`src/shared/flow.ts` puts no cap on the string
 *  itself, so the cap belongs to the reader that has to search a whole page
 *  for it). */
export const OBSERVE_MAX_TEXT_LENGTH = 300
/** Most stated texts one call will search for in a single page pass. */
export const OBSERVE_MAX_TEXTS = 50

/**
 * Runs inside the target page. Shipped as source (`OBSERVE_SCRIPT`) and
 * evaluated in the target's isolated world exactly as `auditPage` is —
 * nothing here trusts anything the page itself defines, and the caller
 * (`ipcPayloads.ts#parseObserveReport`) still checks every field of what
 * comes back before trusting it either.
 *
 * Walks every element the way `auditPage`'s own text pass does — shadow
 * roots included, one entry per element's OWN direct text (a child text
 * node, not a descendant's), so `<div><p>Hello</p></div>` counts once, at
 * `<p>`, not twice by also crediting the wrapping `<div>`. `shown` is the
 * same rendered test `auditPage` already uses for its `text` list: not a
 * zero box, not hidden by style, not the 1×1 "visually hidden" pattern, not
 * parked off the page. An element whose own text matches but fails that
 * test is not dropped — it goes in `unrendered` instead, because "exists in
 * markup but never appeared" is a fact of its own a QA engineer would want,
 * not the same thing as absent.
 */
export function observePage(texts: string[], maxMatches: number, maxUnrendered: number): ObserveReport {
  const label = (el: Element): string => {
    const id = el.id ? `#${el.id}` : ''
    const cls = (el.getAttribute('class') ?? '').split(/\s+/).find(c => c.length > 0)
    return `${el.tagName.toLowerCase()}${id}${cls ? `.${cls}` : ''}`
  }
  const host = rootScrolls() ? null : findScroller().el
  const clipped = clipTest(host)
  const offset = scrollOffset(host)
  const ownRect = (cs: CSSStyleDeclaration, el: Element): DOMRect => {
    if (cs.display !== 'contents') return el.getBoundingClientRect()
    const range = document.createRange()
    range.selectNodeContents(el)
    return range.getBoundingClientRect()
  }
  // Same rule `auditPage` measures its `text` list by (kept identical on
  // purpose: two different answers to "is this rendered" on the same page
  // would be a defect neither could be blamed for alone). The "parked off
  // the page" clause lives at the call site, where `offset(el)` is in scope.
  const shown = (cs: CSSStyleDeclaration, r: DOMRect): boolean =>
    r.width > 0 && r.height > 0 && !(r.width <= 1 && r.height <= 1) && cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0'
  const pageRect = (r: DOMRect, el: Element): ObserveRect => {
    const o = offset(el)
    return { x: r.left + o.x, y: r.top + o.y, width: r.width, height: r.height }
  }

  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TITLE', 'HEAD', 'META', 'LINK'])

  interface Bucket {
    matches: ObserveMatch[]
    matchesOver: number
    unrendered: ObserveMatch[]
    unrenderedOver: number
  }
  const buckets = new Map<string, Bucket>(texts.map(t => [t, { matches: [], matchesOver: 0, unrendered: [], unrenderedOver: 0 }]))
  const renderedCounts = new Map<string, number>(texts.map(t => [t, 0]))
  const unrenderedCounts = new Map<string, number>(texts.map(t => [t, 0]))

  for (const el of shadowElements(document.body ?? document.documentElement)) {
    if (SKIP.has(el.tagName)) continue
    let own = ''
    for (const child of Array.from(el.childNodes)) if (child.nodeType === 3) own += child.textContent ?? ''
    if (own.trim().length === 0) continue
    // Collapsed on both sides for the comparison only — `finding.text` below
    // stays the QA engineer's verbatim string. Markup wraps and indents text
    // across lines constantly; a sighted user sees "Hello world" whichever
    // way the source spells it, and matching the raw text node would make an
    // ordinary line-wrapped template read as absent for no reason a QA
    // engineer's own wording could ever anticipate.
    const ownFlat = own.replace(/\s+/g, ' ')
    let cs: CSSStyleDeclaration | null = null
    let r: DOMRect | null = null
    for (const text of texts) {
      if (!ownFlat.includes(text.replace(/\s+/g, ' '))) continue
      if (cs === null) cs = getComputedStyle(el)
      if (r === null) r = ownRect(cs, el)
      const bucket = buckets.get(text)!
      const rendered = shown(cs, r) && r.right + offset(el).x > 0 && r.bottom + offset(el).y > 0
      if (rendered) {
        renderedCounts.set(text, renderedCounts.get(text)! + 1)
        if (bucket.matches.length >= maxMatches) bucket.matchesOver++
        else bucket.matches.push({ element: label(el), rect: pageRect(r, el) })
      } else {
        unrenderedCounts.set(text, unrenderedCounts.get(text)! + 1)
        if (bucket.unrendered.length >= maxUnrendered) bucket.unrenderedOver++
        else bucket.unrendered.push({ element: label(el), rect: pageRect(r, el) })
      }
    }
  }

  let truncatedMatches = 0
  let truncatedUnrendered = 0
  const findings: ObserveFinding[] = texts.map(text => {
    const bucket = buckets.get(text)!
    truncatedMatches += bucket.matchesOver
    truncatedUnrendered += bucket.unrenderedOver
    return {
      text,
      renderedCount: renderedCounts.get(text)!,
      matches: bucket.matches,
      unrenderedCount: unrenderedCounts.get(text)!,
      unrendered: bucket.unrendered,
    }
  })

  return {
    viewport: { width: innerWidth, height: innerHeight },
    findings,
    truncated: { matches: truncatedMatches, unrendered: truncatedUnrendered },
    frames: framesInViewport(),
  }
}

/** `observePage` as source, for `executeJavaScriptInIsolatedWorld`. */
export const OBSERVE_SCRIPT = `(() => {\n${SCROLL_HOST_SCRIPT}\n return (${observePage.toString()})\n})()`
