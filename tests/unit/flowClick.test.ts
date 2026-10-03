import { describe, expect, it } from 'vitest'
import {
  candidatePoints,
  isWhollyVisible,
  lineBoxPoints,
  MAX_LINE_PROBES,
  noPointHitsRefusal,
  probePoints,
  noMatchRefusal,
  notBroughtIntoViewRefusal,
  SCROLL_PLACEMENT,
  scrollOffsetOf,
  scrollToShow,
  visibleCentre,
  zeroSizeRefusal,
} from '../../src/shared/flowClick'

/**
 * The arithmetic and the refusals behind clicking a flow step's target by
 * selector, tested without an app — which is why they are pure functions over
 * two rects and a viewport rather than code inside the round-trips.
 *
 * The cases that matter are the ones `feat-flow-selector-click` names: an
 * element below the fold must be scrolled to rather than refused, and a refusal
 * must say **which** of the three things went wrong.
 */
const PHONE = { width: 390, height: 844 }

describe('the scroll offset, derived from the two rects', () => {
  it('reads the offset off the difference rather than needing a second call', () => {
    // `pageRect` is the same box with the scroll added, so the difference IS the
    // offset. The point of deriving it: a separately-read offset can disagree
    // with the rects whenever the page moves between the two reads.
    expect(scrollOffsetOf({ x: 12, y: -200, width: 100, height: 40 }, { x: 12, y: 1000, width: 100, height: 40 })).toEqual({ x: 0, y: 1200 })
  })
})

describe('whether a box is inside the viewport', () => {
  it('accepts a box wholly inside', () => {
    expect(isWhollyVisible({ x: 10, y: 20, width: 100, height: 40 }, PHONE)).toBe(true)
  })

  it('refuses a box whose far edge is exactly the viewport width, as parseClick does', () => {
    // `parseClick` refuses `x >= viewport.width`, so the last column of a box
    // ending exactly at 390 is off-screen. A `<=` here would call it visible and
    // hand the click a coordinate the server rejects — the same off-by-one in
    // two places, disagreeing.
    expect(isWhollyVisible({ x: 290, y: 0, width: 100, height: 10 }, PHONE)).toBe(true)
    expect(isWhollyVisible({ x: 291, y: 0, width: 100, height: 10 }, PHONE)).toBe(false)
  })

  it('refuses a box above the fold and one below it', () => {
    expect(isWhollyVisible({ x: 0, y: -1, width: 10, height: 10 }, PHONE)).toBe(false)
    expect(isWhollyVisible({ x: 0, y: 840, width: 10, height: 10 }, PHONE)).toBe(false)
  })
})

describe('the scroll that brings an element into view', () => {
  it('places the element a third down the viewport, not flush against the top', () => {
    // Flush is worse, not simpler: an element at y=0 lands under a sticky header,
    // the click reaches the header, and the flow reports a press that did
    // nothing. A third down clears ordinary chrome without measuring it.
    const rect = { x: 0, y: 1200, width: 200, height: 48 }
    const pageRect = { x: 0, y: 1200, width: 200, height: 48 }
    const to = scrollToShow(rect, pageRect, PHONE)
    expect(to.y).toBe(Math.round(1200 - PHONE.height * SCROLL_PLACEMENT))
    expect(to.y).toBeLessThan(1200)
  })

  it('never asks for a negative offset for an element near the top of the page', () => {
    const rect = { x: 0, y: -40, width: 200, height: 48 }
    const pageRect = { x: 0, y: 10, width: 200, height: 48 }
    expect(scrollToShow(rect, pageRect, PHONE).y).toBe(0)
  })

  it('leaves the axis that is already on screen exactly where it was', () => {
    // The element is below the fold on a page also scrolled sideways. Dragging x
    // back to 0 would be a second change nobody asked for, and on a horizontally
    // paginated layout it changes which section the flow is in.
    const rect = { x: 30, y: 900, width: 100, height: 40 }
    const pageRect = { x: 530, y: 900, width: 100, height: 40 }
    const to = scrollToShow(rect, pageRect, PHONE)
    expect(to.x).toBe(500)
    expect(to.y).toBeLessThan(900)
  })
})

describe('the point a click is sent to', () => {
  it('is the centre of an element that is wholly on screen', () => {
    expect(visibleCentre({ x: 100, y: 200, width: 80, height: 40 }, PHONE)).toEqual({ x: 140, y: 220 })
  })

  it('is the centre of the VISIBLE part when the element straddles an edge', () => {
    // A wide sticky bar, or a list item cut off at the fold after a scroll that
    // could go no further: the element's own centre can be a coordinate `click`
    // refuses while the element is plainly pressable, and the visible centre is
    // where a person would press.
    const straddling = { x: -100, y: 800, width: 300, height: 200 }
    expect(visibleCentre(straddling, PHONE)).toEqual({ x: 100, y: 822 })
  })

  it('stays inside the viewport for a full-width element, because parseClick refuses the far edge', () => {
    const full = { x: 0, y: 0, width: 780, height: 10 }
    const point = visibleCentre(full, PHONE)!
    expect(point.x).toBeLessThan(PHONE.width)
  })

  it('is null when nothing of the element is on screen, rather than a clamped guess', () => {
    // There is no honest point then. A clamped one would press whatever IS at
    // the edge and report it as the element.
    expect(visibleCentre({ x: 0, y: 900, width: 10, height: 10 }, PHONE)).toBeNull()
    expect(visibleCentre({ x: -50, y: 0, width: 50, height: 10 }, PHONE)).toBeNull()
  })
})

describe('the refusals, which must say which of the three it was', () => {
  it('a selector matching nothing carries inspect own note, so a typo is not read as an absent element', () => {
    const r = noMatchRefusal('.chekout', ['".chekout" is not a valid CSS selector, so nothing was looked for'])
    expect(r).toContain('no element matches ".chekout"')
    expect(r).toContain('not a valid CSS selector')
  })

  it('a selector matching nothing, with no note, still says what it was about', () => {
    expect(noMatchRefusal('.gone', [])).toContain('nothing to click')
  })

  it('a zero-size element names the box, and carries inspect own not-drawn sentence when there is one', () => {
    // **The note, not a field.** `inspect` has no `hidden` key — it turns that
    // report field into a sentence in `notes` — and reading a field that does not
    // exist is exactly what the live run caught: a `display: none` button
    // refused with `0x0` and named no rule at all.
    const hidden = zeroSizeRefusal('#none', { x: 0, y: 0, width: 0, height: 0 }, [
      'this element is not drawn: display: none on it or on an ancestor. The measurements below are of a box the screen never shows',
    ])
    expect(hidden).toContain('no area')
    expect(hidden).toContain('display: none')
    // And without such a note it does not invent one — a 0-height element with
    // everything visible is a layout fact, not a hidden element.
    const bare = zeroSizeRefusal('#empty', { x: 4, y: 8, width: 120, height: 0 }, [])
    expect(bare).toContain('120x0 at 4,8')
    expect(bare).not.toContain('not drawn')
    // Notes about something else are not dragged in either: only the sentence
    // that explains an absent box belongs in a refusal about an absent box.
    const other = zeroSizeRefusal('#empty', { x: 0, y: 0, width: 0, height: 0 }, ['the page is at 2x, so the 4px text measures 0.7mm'])
    expect(other).not.toContain('2x')
  })

  it('an element that could not be brought into view names the scroll that was tried', () => {
    const r = notBroughtIntoViewRefusal('.footer-cta', { x: 0, y: 900, width: 200, height: 40 }, PHONE, { x: 0, y: 1200 })
    expect(r).toContain('still outside the 390x844 viewport after scrolling to 0,1200')
    // The two causes worth naming, because they are what a reader checks next.
    expect(r).toContain('inner element')
    expect(r).toContain('fixed element')
  })

  it('gives three different sentences for the three failures, so a reader can tell them apart', () => {
    const three = [
      noMatchRefusal('.a', []),
      zeroSizeRefusal('.a', { x: 0, y: 0, width: 0, height: 0 }, []),
      notBroughtIntoViewRefusal('.a', { x: 0, y: 900, width: 1, height: 1 }, PHONE, { x: 0, y: 0 }),
    ]
    expect(new Set(three).size).toBe(3)
    // And none of them is the generic sentence this card exists to replace.
    for (const r of three) expect(r).not.toBe('click failed')
  })
})

/**
 * The candidate points, and the measurement that made them necessary.
 *
 * `bug-selector-click-presses-the-gap`: the border box of a **wrapped inline** element is the union of
 * its line boxes plus the leading between them, and that gap paints as the parent block. On
 * `books.toscrape.com` at 360 px the anchor's lines were 514.2–531.2 and 534.2–551.2, the union box
 * 514.2–551.2, and its centre 532.7 — strictly inside the 3 px gap, where `elementFromPoint` answers
 * `<h3>`. The centre was the only point the first version tried.
 */
describe('the points worth trying inside a box', () => {
  it('offers the centre first, because for a block element it is the right point', () => {
    expect(candidatePoints({ x: 100, y: 200, width: 80, height: 40 }, PHONE)[0]).toEqual({ x: 140, y: 220 })
  })

  it('offers points inside the first and last lines of a two-line inline, which the centre misses', () => {
    // The real geometry, viewport-relative: a 37px-tall union box whose two 17px
    // lines leave a ~3px gap in the middle.
    const wrapped = { x: 77.6, y: 266.8, width: 77.3, height: 36.5 }
    const points = candidatePoints(wrapped, PHONE)
    const gapTop = 266.8 + 17
    const gapBottom = 266.8 + 20
    const inGap = (p: { y: number }): boolean => p.y >= gapTop && p.y <= gapBottom
    expect(inGap(points[0]!), 'the centre is the point that lands in the gap — that is the defect').toBe(true)
    // And what the fix adds: points that are NOT in the gap, above and below it.
    expect(points.some(p => p.y < gapTop), 'no candidate lands in the first line').toBe(true)
    expect(points.some(p => p.y > gapBottom), 'no candidate lands in the last line').toBe(true)
  })

  it('reaches leftward as well, for a final line shorter than the box', () => {
    const points = candidatePoints({ x: 0, y: 0, width: 200, height: 40 }, PHONE)
    expect(points.some(p => p.x < 100)).toBe(true)
  })

  it('keeps every candidate inside the viewport, since a click outside it is refused', () => {
    const straddling = { x: -40, y: 780, width: 300, height: 100 }
    for (const p of candidatePoints(straddling, PHONE)) {
      expect(p.x).toBeGreaterThanOrEqual(0)
      expect(p.y).toBeGreaterThanOrEqual(0)
      expect(p.x).toBeLessThan(PHONE.width)
      expect(p.y).toBeLessThan(PHONE.height)
    }
  })

  it('returns nothing for a box with no on-screen part, rather than a clamped guess', () => {
    expect(candidatePoints({ x: 0, y: 900, width: 10, height: 10 }, PHONE)).toEqual([])
  })

  it('does not repeat a point, so a tiny box costs one probe and not five', () => {
    const tiny = { x: 10, y: 10, width: 1, height: 1 }
    const points = candidatePoints(tiny, PHONE)
    expect(points).toHaveLength(1)
  })
})

describe('the refusal for a box whose points all miss', () => {
  it('names what was tried and what answered instead', () => {
    const r = noPointHitsRefusal('.product_pod h3 a', { x: 77.6, y: 266.8, width: 77.3, height: 36.5 }, 5, ['h3', 'h3'])
    expect(r).toContain('.product_pod h3 a')
    expect(r).toContain('no point inside it')
    // Deduplicated: five probes hitting the same parent is one fact, not five.
    expect(r).toContain('resolved to h3 instead')
    // And it names the shape, because "click failed" is what this whole card is about.
    expect(r).toContain('text wraps')
  })

  it('says nothing about what it saw when it saw nothing, rather than an empty list', () => {
    const r = noPointHitsRefusal('.x', { x: 0, y: 0, width: 10, height: 10 }, 5, [])
    expect(r).not.toContain('instead')
  })
})

describe('the points worth trying when the page reports the element’s own boxes', () => {
  const viewport = { width: 390, height: 844 }

  it('is the centre of a block’s single box — the point the centre-first heuristic already chose', () => {
    expect(lineBoxPoints([{ x: 20, y: 100, width: 240, height: 56 }], viewport)).toEqual([{ x: 140, y: 128 }])
  })

  it('aims inside each line of a wrapped inline, never at the leading between them', () => {
    // Two lines 16 px tall with 20 px of leading between: the union runs 100–152, its centre (126) is
    // in the gap that paints as the parent. The boxes' own centres are not.
    const lines = [
      { x: 20, y: 100, width: 150, height: 16 },
      { x: 20, y: 136, width: 60, height: 16 },
    ]
    const points = lineBoxPoints(lines, viewport)
    expect(points).toEqual([{ x: 95, y: 108 }, { x: 50, y: 144 }])
    for (const p of points) expect(lines.some(q => p.y >= q.y && p.y < q.y + q.height)).toBe(true)
    expect(points.some(p => p.y >= 116 && p.y < 136), 'a point in the gap').toBe(false)
  })

  it('puts the largest visible box first, so a short final line is not the first thing pressed', () => {
    const lines = [
      { x: 20, y: 100, width: 40, height: 16 },
      { x: 20, y: 120, width: 200, height: 16 },
      { x: 20, y: 140, width: 90, height: 16 },
    ]
    expect(lineBoxPoints(lines, viewport).map(p => p.y)).toEqual([128, 148, 108])
  })

  it('keeps document order between boxes of equal visible area, so two reads of a page agree', () => {
    const lines = [
      { x: 20, y: 100, width: 100, height: 16 },
      { x: 20, y: 120, width: 100, height: 16 },
    ]
    expect(lineBoxPoints(lines, viewport).map(p => p.y)).toEqual([108, 128])
  })

  it('measures a box cut by the viewport edge by the part that is visible, and drops one that is not visible at all', () => {
    const lines = [
      { x: 20, y: 842, width: 300, height: 40 }, // 12 000 px² in all, but 2 px of it visible: 600 px²
      { x: 20, y: 700, width: 50, height: 20 }, // 1000 px² visible, wins on the part that shows
      { x: 20, y: 900, width: 300, height: 40 }, // below the fold entirely
      { x: -400, y: 10, width: 300, height: 40 }, // left of it entirely
    ]
    const points = lineBoxPoints(lines, viewport)
    expect(points).toHaveLength(2)
    expect(points[0]).toEqual({ x: 45, y: 710 })
    // The cut box's point is the centre of what shows (842–844), and a coordinate `click` accepts.
    expect(points[1]).toEqual({ x: 170, y: 843 })
    for (const p of points) {
      expect(p.x).toBeLessThan(viewport.width)
      expect(p.y).toBeLessThan(viewport.height)
    }
  })

  it('tries no more than the ceiling the five fixed fractions had', () => {
    const lines = Array.from({ length: 12 }, (_, i) => ({ x: 20, y: 20 + i * 30, width: 100 + i, height: 16 }))
    expect(MAX_LINE_PROBES).toBe(5)
    expect(lineBoxPoints(lines, viewport)).toHaveLength(MAX_LINE_PROBES)
  })

  it('does not offer the same pixel twice', () => {
    const same = { x: 20, y: 100, width: 100, height: 16 }
    expect(lineBoxPoints([same, { ...same }], viewport)).toHaveLength(1)
  })

  it('offers nothing for no boxes — the caller refuses, it does not invent a point', () => {
    expect(lineBoxPoints([], viewport)).toEqual([])
  })
})

describe('the refusal when the page reported the boxes and none of them resolves', () => {
  const rect = { x: 10, y: 20, width: 100, height: 60 }

  it('says no point in any line box resolves, and names what was drawn there instead', () => {
    const msg = noPointHitsRefusal('a.buy', rect, 2, ['div.sticky-header'], 3)
    expect(msg).toContain('"a.buy"')
    expect(msg).toContain('no point inside it resolves to that element')
    expect(msg).toContain('the centre of each of its 3 line boxes was tried first, then the fixed points inside the box')
    expect(msg).toContain('the 2 points tried resolved to div.sticky-header instead')
  })

  it('does not blame the wrapped-inline gap, which was never a candidate when the boxes were known', () => {
    expect(noPointHitsRefusal('a.buy', rect, 2, [], 3)).not.toContain('the gap between them')
  })

  it('says none of the boxes is on screen when nothing could be tried, and is singular for one box', () => {
    expect(noPointHitsRefusal('a.buy', rect, 0, [], 2)).toContain('none of its 2 line boxes is on screen')
    expect(noPointHitsRefusal('a.buy', rect, 0, [], 1)).toContain('none of its 1 line box is on screen')
  })

  it('keeps the original wording, gap explanation and all, when the app reported no boxes', () => {
    const msg = noPointHitsRefusal('a.buy', rect, 5, ['h3'])
    expect(msg).toContain('the gap between them')
    expect(msg).toContain('the 5 points tried resolved to h3 instead')
  })
})

describe('the points tried for an element: its line boxes first, the fixed points always after', () => {
  const viewport = { width: 390, height: 844 }
  const key = (p: { x: number; y: number }): string => `${p.x},${p.y}`

  it('is the fixed points alone when the app reported no boxes — an app older than the field', () => {
    const rect = { x: 20, y: 100, width: 150, height: 52 }
    expect(probePoints(rect, undefined, viewport)).toEqual(candidatePoints(rect, viewport))
  })

  it('puts a wrapped link’s line-box centres before its fixed points, so the first probe lands', () => {
    const lines = [
      { x: 20, y: 100, width: 150, height: 16 },
      { x: 20, y: 136, width: 60, height: 16 },
    ]
    const union = { x: 20, y: 100, width: 150, height: 52 }
    const points = probePoints(union, lines, viewport)
    expect(points.slice(0, 2)).toEqual(lineBoxPoints(lines, viewport))
    // The union's centre (y = 126) is in the leading between the lines. It is still offered, but last-ish.
    expect(points.some(p => p.y === 126)).toBe(true)
    expect(points.findIndex(p => p.y === 126)).toBeGreaterThan(1)
  })

  it('is one point for a block, because its box’s centre is also the first fixed point', () => {
    const block = { x: 20, y: 100, width: 240, height: 56 }
    expect(probePoints(block, [block], viewport)[0]).toEqual({ x: 140, y: 128 })
    expect(probePoints(block, [block], viewport).filter(p => key(p) === '140,128')).toHaveLength(1)
  })

  it('never offers the same pixel twice', () => {
    const block = { x: 20, y: 100, width: 240, height: 56 }
    const points = probePoints(block, [block, { ...block }], viewport)
    expect(new Set(points.map(key)).size).toBe(points.length)
  })

  it('always contains every point the fixed heuristic had — so nothing that worked before can refuse', () => {
    // The structural guarantee behind the fix, over a spread of boxes and line-box lists, including ones
    // that cover only part of the box, sit off screen, or are empty.
    const boxes = [
      { x: 20, y: 100, width: 150, height: 52 },
      { x: 0, y: 0, width: 390, height: 844 },
      { x: 300, y: 800, width: 200, height: 100 },
      { x: 10, y: 10, width: 1, height: 1 },
      { x: 40.5, y: 220.25, width: 77.3, height: 36.5 },
    ]
    const lists: Array<Array<{ x: number; y: number; width: number; height: number }>> = [
      [],
      [{ x: 20, y: 100, width: 5, height: 5 }],
      [{ x: 500, y: 500, width: 20, height: 20 }],
      [{ x: 20, y: 100, width: 150, height: 16 }, { x: 20, y: 136, width: 60, height: 16 }],
    ]
    for (const rect of boxes) {
      const fixed = candidatePoints(rect, viewport).map(key)
      for (const lineRects of lists) {
        const offered = new Set(probePoints(rect, lineRects, viewport).map(key))
        for (const k of fixed) expect(offered.has(k), `${k} from ${JSON.stringify(rect)} with ${JSON.stringify(lineRects)}`).toBe(true)
      }
    }
  })

  it('still offers the fixed points when the reported boxes are empty or all off screen', () => {
    const rect = { x: 20, y: 100, width: 150, height: 52 }
    expect(probePoints(rect, [], viewport)).toEqual(candidatePoints(rect, viewport))
    expect(probePoints(rect, [{ x: 900, y: 900, width: 10, height: 10 }], viewport)).toEqual(candidatePoints(rect, viewport))
  })
})
