/// <reference lib="dom" />
// The DOM lib is pulled in for this file alone, as in `audit.ts`: the walk is
// written here so the CLI can ship it as source; nothing in this file runs
// outside the target page except the string.

/**
 * Chrome that stays put while the page scrolls, and what a banded full-page
 * capture has to do about it.
 *
 * A banded capture holds the viewport at the screen's own size and scrolls the
 * page a screenful at a time. Chrome stuck to the top of the viewport is
 * therefore painted into *every* band, and it costs twice: the stitched raster
 * shows five identical headers down a six-band page, and — the part that is
 * not cosmetic — the page rows behind the header in bands 2..N are painted
 * over, so they appear in no band at all. Measured on tailwindcss.com/docs at
 * laptop-768: a 57 px header over five later bands, 285 rows of the page in
 * the raster nowhere.
 *
 * Detection is empirical rather than a reading of `position`, because both
 * values do this: tailwindcss.com/docs sticks its header with `fixed`,
 * developer.mozilla.org with `sticky` (measured at 1366×768; MDN also has two
 * `sticky` side rails). An element whose viewport rect is the same at two
 * different scroll offsets is stuck, whatever CSS put it there.
 *
 * The two offsets must both be *past* the first band. A `sticky` element sits
 * at its natural place at the top of the page and only stops when the page has
 * scrolled under it, so comparing scroll 0 against band 2 finds nothing on MDN
 * — measured, and the reason the probe scrolls twice rather than reusing the
 * band-1 capture.
 */

/** Fraction of the viewport width at which a stuck element counts as a bar. */
export const STUCK_BAR_MIN_WIDTH = 0.9
/** A bar is not the whole screen: past this fraction of viewport height it is an overlay, not chrome. */
export const STUCK_BAR_MAX_HEIGHT = 0.5
/**
 * Elements the scan may visit. A page with a pathological DOM must not stall
 * the capture; past this the bars found so far are what there is.
 */
export const STUCK_MAX_SCANNED = 20_000
/** Slack for sub-pixel layout, as in scrollHost.ts. */
const STUCK_EPSILON = 1

/** One piece of stuck chrome, for the JSON and the human line. */
export interface StuckBar {
  /** `tag#id.first-class`, the page's own selector for it. */
  element: string
  /** Its computed `position` — which of the two ways the page stuck it. */
  position: string
  top: number
  height: number
}

export interface StuckChrome {
  /** Snapshot every candidate's viewport rect at the current scroll. */
  mark(): void
  /** Compare against `mark`: what has not moved, and is a full-bleed bar. */
  settle(): StuckBar[]
  /** Hide what `settle` found, remembering each element's own inline style. */
  hide(): void
  /** Put every inline style back exactly as it was. */
  restore(): void
}

/**
 * Installs the controller on the page. Kept as one function so the CLI can
 * ship it as source and drive it over four round trips; it holds the marked
 * rects and the saved inline styles between them, which is the whole reason
 * it is a closure rather than four loose functions.
 *
 * Hiding is `visibility: hidden`, never `display: none`: `visibility` takes an
 * element out of the paint and leaves the layout untouched, so every band is
 * laid out exactly as it would have been. `display: none` would reflow the
 * page mid-capture and the bands would no longer stitch.
 */
export function installStuckChrome(minWidth: number, maxHeight: number, maxScanned: number): StuckChrome {
  const label = (el: Element): string => {
    const id = el.id ? `#${el.id}` : ''
    const cls = (el.getAttribute('class') ?? '').split(/\s+/).find(c => c.length > 0)
    return `${el.tagName.toLowerCase()}${id}${cls ? `.${cls}` : ''}`
  }
  const candidates = (): Map<Element, DOMRect> => {
    const found = new Map<Element, DOMRect>()
    let scanned = 0
    for (const el of Array.from(document.querySelectorAll('*'))) {
      if (scanned++ >= maxScanned) break
      const position = getComputedStyle(el).position
      if (position !== 'fixed' && position !== 'sticky') continue
      const r = el.getBoundingClientRect()
      if (r.width <= 0 || r.height <= 0) continue
      found.set(el, r)
    }
    return found
  }

  let marked = new Map<Element, DOMRect>()
  let bars: Element[] = []
  const saved = new Map<Element, { value: string; priority: string }>()

  return {
    mark(): void {
      marked = candidates()
    },
    settle(): StuckBar[] {
      const same = (a: DOMRect, b: DOMRect): boolean =>
        Math.abs(a.top - b.top) < STUCK_EPSILON &&
        Math.abs(a.left - b.left) < STUCK_EPSILON &&
        Math.abs(a.width - b.width) < STUCK_EPSILON &&
        Math.abs(a.height - b.height) < STUCK_EPSILON
      const found: Element[] = []
      for (const [el, now] of candidates()) {
        const before = marked.get(el)
        if (!before || !same(before, now)) continue
        // A bar, not a rail and not an overlay: a rail covers no page content,
        // and hiding one would leave a blank column down every band after the
        // first (MDN has two, 20% wide). Full-bleed chrome is what paints over
        // the page.
        if (now.width < innerWidth * minWidth) continue
        if (now.height > innerHeight * maxHeight) continue
        found.push(el)
      }
      // A bar inside a bar is hidden by its ancestor; listing both would
      // overstate what was removed (MDN's rail header sits inside its rail).
      bars = found.filter(el => !found.some(other => other !== el && other.contains(el)))
      return bars.map(el => {
        const r = el.getBoundingClientRect()
        return { element: label(el), position: getComputedStyle(el).position, top: Math.round(r.top), height: Math.round(r.height) }
      })
    },
    hide(): void {
      for (const el of bars) {
        const style = (el as HTMLElement).style
        if (!style) continue
        if (!saved.has(el)) saved.set(el, { value: style.getPropertyValue('visibility'), priority: style.getPropertyPriority('visibility') })
        style.setProperty('visibility', 'hidden', 'important')
      }
    },
    restore(): void {
      for (const [el, was] of saved) {
        const style = (el as HTMLElement).style
        if (!style) continue
        // Exactly as it was: a page that had no inline `visibility` gets the
        // property removed, not set to the empty string.
        if (was.value === '') style.removeProperty('visibility')
        else style.setProperty('visibility', was.value, was.priority)
      }
      saved.clear()
    },
  }
}

/**
 * The installer serialised for `executeJavaScript` in the headless render,
 * composed from its own source as `SCROLL_HOST_SCRIPT` is. Evaluating it
 * leaves `window.__obsrvChrome` on the page, ready for `mark`, `settle`,
 * `hide` and `restore`.
 */
export const STUCK_CHROME_SCRIPT = [
  `const STUCK_EPSILON = ${STUCK_EPSILON}`,
  installStuckChrome.toString(),
  `window.__obsrvChrome = installStuckChrome(${STUCK_BAR_MIN_WIDTH}, ${STUCK_BAR_MAX_HEIGHT}, ${STUCK_MAX_SCANNED})`,
  '0',
].join('\n')
