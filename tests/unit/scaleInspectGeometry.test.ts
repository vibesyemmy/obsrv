import { describe, expect, it } from 'vitest'
import { scaleInspectGeometry, type InspectReport } from '../../src/shared/inspect'

/**
 * `TargetSource.inspectAt` and `inspectSelector` both hand the caller a box in
 * the text-scaled space. The line boxes a click by selector aims at have to be
 * in that same space, or the point is chosen in one coordinate system and
 * checked against a box in another. Both callers use this one function so that
 * cannot drift; this pins what it does to every box in the report.
 */
const report: InspectReport = {
  tag: 'a',
  id: '',
  classes: '',
  text: 'a wrapped link',
  rect: { x: 10, y: 20, width: 100, height: 60 },
  fontSizePx: 14,
  fontWeight: 400,
  fontFamily: 'Inter',
  color: [0, 0, 0, 1],
  background: [255, 255, 255, 1],
  backgroundNote: 'computed',
  opacity: 1,
  hidden: null,
  editable: false,
  inputType: null,
  disabled: false,
  readOnly: false,
  lineRects: [
    { x: 10, y: 20, width: 100, height: 16 },
    { x: 10, y: 64, width: 40, height: 16 },
  ],
  scroll: { x: 0, y: 300 },
}

describe('scaleInspectGeometry', () => {
  it('is the identity at scale 1, returning the very report it was given', () => {
    expect(scaleInspectGeometry(report, 1)).toBe(report)
  })

  it('leaves the scroll in the page\'s px: it is added to a scaled rect as the record always was, and is not itself a box', () => {
    // `pageRect = rect + scroll` has always mixed the surface-px rect with a page-px scroll, and the selector
    // click's scroll arithmetic (`scrollToShow`) divides by the scale on exactly that reading. Scaling the
    // scroll here would change what `pageRect - rect` means.
    expect(scaleInspectGeometry(report, 1.5).scroll).toEqual({ x: 0, y: 300 })
  })

  it('scales the box and every line box by the same factor', () => {
    const scaled = scaleInspectGeometry(report, 1.5)
    expect(scaled.rect).toEqual({ x: 15, y: 30, width: 150, height: 90 })
    expect(scaled.lineRects).toEqual([
      { x: 15, y: 30, width: 150, height: 24 },
      { x: 15, y: 96, width: 60, height: 24 },
    ])
  })

  it('keeps the line boxes inside the box after scaling — the relation a click relies on', () => {
    const { rect, lineRects } = scaleInspectGeometry(report, 2.5)
    for (const q of lineRects) {
      expect(q.x).toBeGreaterThanOrEqual(rect.x)
      expect(q.y).toBeGreaterThanOrEqual(rect.y)
      expect(q.x + q.width).toBeLessThanOrEqual(rect.x + rect.width)
      expect(q.y + q.height).toBeLessThanOrEqual(rect.y + rect.height)
    }
  })

  it('leaves everything else alone — the font size is what the stylesheet says — and does not mutate its input', () => {
    const before = JSON.stringify(report)
    const scaled = scaleInspectGeometry(report, 2)
    expect(scaled.fontSizePx).toBe(14)
    expect(scaled.text).toBe('a wrapped link')
    expect(JSON.stringify(report)).toBe(before)
  })
})
