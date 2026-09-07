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
 *
 * An app shell bands the same way with the scroller in place of the window,
 * and everything above is then said of *the scroller*: its own sticky toolbar
 * or table header is what repeats, the app's chrome outside it is sliced out
 * of those bands already, and a bar spanning a scroller inset from the window
 * is nowhere near full-bleed against the viewport. So the frame the whole
 * measurement is taken in is the scroll host's box when there is one, and the
 * viewport when the window is what scrolls.
 */

/** Fraction of the frame's width at which a stuck element counts as a bar. */
export const STUCK_BAR_MIN_WIDTH = 0.9
/** A bar is not the whole frame: past this fraction of its height it is an overlay, not chrome. */
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
 * `host` is the element the capture scrolls, or null when the window is. It is
 * the frame every measurement is taken in — what counts as full-bleed, and
 * what is near enough the bands to matter at all.
 *
 * Hiding is `visibility: hidden`, never `display: none`: `visibility` takes an
 * element out of the paint and leaves the layout untouched, so every band is
 * laid out exactly as it would have been. `display: none` would reflow the
 * page mid-capture and the bands would no longer stitch.
 */
export function installStuckChrome(minWidth: number, maxHeight: number, maxScanned: number, host: Element | null): StuckChrome {
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
      // The frame: the scroll host's box, or the viewport. Its client size is
      // what "full-bleed" is measured against, so a scrollbar or a border does
      // not push a bar spanning a panel under the threshold.
      const box = host ? host.getBoundingClientRect() : new DOMRect(0, 0, innerWidth, innerHeight)
      const frameWidth = host ? host.clientWidth : innerWidth
      const frameHeight = host ? host.clientHeight : innerHeight
      // Whatever holds the content the bands show must never be hidden:
      // hiding an ancestor of the scroller hides the scroller, and with it the
      // whole capture. An app shell rooted in a `position: fixed` wrapper is
      // exactly that shape, and it is stuck by every other test here.
      const anchor: Element | null = host ?? document.scrollingElement
      const found: Element[] = []
      for (const [el, now] of candidates()) {
        const before = marked.get(el)
        if (!before || !same(before, now)) continue
        if (anchor && (el === anchor || el.contains(anchor))) continue
        // Outside the frame it is not in the bands to begin with: an app
        // shell's header sits above the scroller, and every band after the
        // first is sliced down to the scroller's own rows.
        if (
          now.right <= box.left + STUCK_EPSILON ||
          now.left >= box.right - STUCK_EPSILON ||
          now.bottom <= box.top + STUCK_EPSILON ||
          now.top >= box.bottom - STUCK_EPSILON
        ) {
          continue
        }
        // A bar, not a rail and not an overlay: a rail covers no page content,
        // and hiding one would leave a blank column down every band after the
        // first (MDN has two, 20% wide). Full-bleed chrome is what paints over
        // the page.
        if (now.width < frameWidth * minWidth) continue
        if (now.height > frameHeight * maxHeight) continue
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
  // `__obsrvScrollHost` is what the full-page capture already left on the
  // page: the element it scrolls, or null when the window is. One script
  // serves both band loops because that one value is the whole difference.
  `window.__obsrvChrome = installStuckChrome(${STUCK_BAR_MIN_WIDTH}, ${STUCK_BAR_MAX_HEIGHT}, ${STUCK_MAX_SCANNED}, window.__obsrvScrollHost || null)`,
  '0',
].join('\n')
