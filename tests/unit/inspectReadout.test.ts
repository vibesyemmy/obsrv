import { describe, expect, it } from 'vitest'
import type { InspectReport } from '../../src/shared/inspect'
import { inspectReadout, invalidSelectorNote, isLargeText, pointOffScreenNote, type InspectPanel, type InspectScreen } from '../../src/shared/inspectReadout'
import { parseClick } from '../../src/shared/control'
import { profileToParams } from '../../src/shared/panelSim'
import { DEFAULT_SETTINGS, findPreset, findProfile } from '../../src/shared/presets'
import { visionMatrix } from '../../src/shared/vision'

const grey: InspectReport = {
  tag: 'p',
  id: 'grey',
  classes: 'caption small',
  text: 'Grey caption text on white',
  rect: { x: 16.4, y: 8, width: 300, height: 18.2 },
  fontSizePx: 13,
  fontWeight: 400,
  fontFamily: 'Inter',
  color: [107, 114, 128, 1],
  background: [255, 255, 255, 1],
  backgroundNote: 'computed',
  opacity: 1,
  hidden: null,
}

const screenOf = (id: string, textScale = 1): InspectScreen => {
  const p = findPreset(id)
  return { cssWidth: p.width, cssHeight: p.height, deviceScaleFactor: p.deviceScaleFactor, diagonalInches: p.diagonalInches, textScale }
}
const panelOf = (id: string): InspectPanel => {
  const profile = findProfile(id)
  return { profileId: profile.id, profileLabel: profile.label, params: profileToParams(profile, DEFAULT_SETTINGS.hostNits) }
}

describe('inspectReadout', () => {
  it('names the element, gives the font in millimetres on the screen, and the contrast twice', () => {
    const r = inspectReadout(grey, screenOf('laptop-768'), panelOf('reference'))
    expect(r.element).toBe('p#grey.caption')
    expect(r.ppi).toBe(100)
    expect(r.font.px).toBe(13)
    expect(r.font.mm).toBeCloseTo(3.29, 2)
    expect(r.rect).toEqual({ x: 16.4, y: 8, width: 300, height: 18.2 })
    expect(r.rectMm?.width).toBeCloseTo(75.86, 1)
    expect(r.color).toBe('#6b7280')
    expect(r.background).toBe('#ffffff')
    expect(r.contrast).toMatchObject({ largeText: false, aaThreshold: 4.5, passesAsIs: true, panel: 'reference' })
    expect(r.contrast!.asIs).toBeCloseTo(4.83, 2)
    // The reference panel is the identity: the two figures agree.
    expect(r.contrast!.onPanel).toBeCloseTo(r.contrast!.asIs, 1)
    expect(r.contrast!.vision).toBeUndefined()
  })
  it('a budget TN panel pulls the pair together: the second figure is lower, and can fail where the first passes', () => {
    const r = inspectReadout(grey, screenOf('laptop-768'), panelOf('budget-tn'))
    expect(r.contrast!.onPanel).toBeLessThan(r.contrast!.asIs)
    expect(r.contrast!.panel).toBe('budget-tn')
    expect(r.contrast!.passesAsIs).toBe(true)
    expect(r.contrast!.passesOnPanel).toBe(r.contrast!.onPanel >= 4.5)
  })
  it('a vision simulation is named and applied to the panel figure', () => {
    const panel = { ...panelOf('reference'), vision: { label: 'deutan 100%', matrix: visionMatrix('deutan', 1) } }
    const r = inspectReadout({ ...grey, color: [200, 0, 0, 1], background: [0, 160, 0, 1] }, screenOf('laptop-768'), panel)
    expect(r.contrast!.vision).toBe('deutan 100%')
    expect(r.contrast!.onPanel).not.toBeCloseTo(r.contrast!.asIs, 1)
  })
  it('millimetres follow the screen: the same 13px is bigger on a 24" 1080p and smaller on a phone', () => {
    expect(inspectReadout(grey, screenOf('1080p-24'), panelOf('reference')).font.mm).toBeCloseTo(3.6, 1)
    // 13 px at 2x on a 6.5" 720-wide phone: 26 device px at ~270 ppi, 2.45 mm.
    expect(inspectReadout(grey, screenOf('android-65'), panelOf('reference')).font.mm).toBeCloseTo(2.45, 1)
  })
  it('a text scale grows the font on the glass but not the box, which is already in surface px', () => {
    const plain = inspectReadout(grey, screenOf('laptop-768'), panelOf('reference'))
    const scaled = inspectReadout(grey, screenOf('laptop-768', 1.5), panelOf('reference'))
    expect(scaled.font.mm).toBeCloseTo(plain.font.mm! * 1.5, 1)
    expect(scaled.rectMm).toEqual(plain.rectMm)
  })
  it('no diagonal: no density, no millimetres, everything else intact', () => {
    const r = inspectReadout(grey, { ...screenOf('laptop-768'), diagonalInches: null }, panelOf('reference'))
    expect(r.ppi).toBeNull()
    expect(r.font.mm).toBeNull()
    expect(r.rectMm).toBeNull()
    expect(r.contrast!.asIs).toBeCloseTo(4.83, 2)
  })
  it('text over an image has colours but no contrast, and says so', () => {
    const r = inspectReadout({ ...grey, background: null, backgroundNote: 'image' }, screenOf('laptop-768'), panelOf('reference'))
    expect(r.background).toBeNull()
    expect(r.backgroundNote).toBe('image')
    expect(r.contrast).toBeNull()
  })
  it('large text is judged at 3:1', () => {
    expect(isLargeText(24, 400)).toBe(true)
    expect(isLargeText(23.9, 400)).toBe(false)
    expect(isLargeText(18.66, 700)).toBe(true)
    expect(isLargeText(18.66, 600)).toBe(false)
    const r = inspectReadout({ ...grey, fontSizePx: 24, color: [140, 140, 140, 1] }, screenOf('laptop-768'), panelOf('reference'))
    expect(r.contrast).toMatchObject({ largeText: true, aaThreshold: 3, passesAsIs: true })
    const small = inspectReadout({ ...grey, fontSizePx: 14, color: [140, 140, 140, 1] }, screenOf('laptop-768'), panelOf('reference'))
    expect(small.contrast).toMatchObject({ largeText: false, aaThreshold: 4.5, passesAsIs: false })
  })
})

/**
 * A page with no viewport meta tag under a phone preset lays out 980 CSS px
 * wide and is drawn scaled to fit: the box and the font are in the page's own
 * layout px, and the millimetres are of the element as drawn.
 */
describe('inspectReadout on a page drawn scaled to fit (no viewport meta)', () => {
  it('scales the millimetres, leaves the px alone, and says so in its notes', () => {
    const r = inspectReadout({ ...grey, viewportWidth: 980 }, screenOf('android-65'), panelOf('reference'))
    expect(r.layoutScale).toBeCloseTo(360 / 980, 4)
    // 13 px × 360/980 = 4.78 CSS px at 2x on 269.9 ppi: 0.90 mm (2.45 unscaled).
    expect(r.font.px).toBe(13)
    expect(r.font.mm).toBeCloseTo(0.9, 2)
    // 300 px wide drawn at 110: 20.7 mm (56.5 unscaled).
    expect(r.rect.width).toBe(300)
    expect(r.rectMm?.width).toBeCloseTo(20.74, 1)
    expect(r.notes).toHaveLength(1)
    expect(r.notes[0]).toMatch(/lays out 980 CSS px wide where the screen gives it 360 and is drawn at 0\.37× to fit/)
  })
  it('is scale 1 with no note for a page that fits, and for a report from before the field', () => {
    const fits = inspectReadout({ ...grey, viewportWidth: 360 }, screenOf('android-65'), panelOf('reference'))
    expect(fits.layoutScale).toBe(1)
    expect(fits.notes).toEqual([])
    expect(fits.font.mm).toBeCloseTo(2.45, 1)
    const older = inspectReadout(grey, screenOf('android-65'), panelOf('reference'))
    expect(older.layoutScale).toBe(1)
    expect(older.font.mm).toBeCloseTo(2.45, 1)
  })
})

describe('pointOffScreenNote', () => {
  const phone = { width: 412, height: 915 }

  it('says nothing for a point on the screen, up to the last fraction of the last pixel', () => {
    for (const at of [{ x: 0, y: 0 }, { x: 206, y: 457 }, { x: 411, y: 914 }, { x: 411.99, y: 914.99 }]) {
      expect(pointOffScreenNote(at, phone), JSON.stringify(at)).toBeNull()
    }
  })

  it('names the point, the viewport, and what found: false then means, past either edge', () => {
    const note = pointOffScreenNote({ x: 1000, y: 500 }, phone)
    expect(note).toContain('the point (1000, 500) is outside')
    expect(note).toContain('412x915')
    expect(note).toContain('found: false is about the point, not the page')
    expect(note).toContain('--selector (selector)')
    expect(pointOffScreenNote({ x: 412, y: 0 }, phone)).toContain('(412, 0)')
    expect(pointOffScreenNote({ x: 0, y: 915 }, phone)).toContain('(0, 915)')
    expect(pointOffScreenNote({ x: 411.5, y: 915.25 }, phone)).toContain('(411.5, 915.25)')
  })

  it('draws the edge where a click does, so the two tools agree on which points exist', () => {
    const edges = [-1, -0.01, 0, 0.5, 411, 411.5, 411.99, 412, 412.01, 914, 914.99, 915, 1000]
    let outside = 0
    for (const x of edges) {
      for (const y of edges) {
        const click = parseClick({ x, y }, phone)
        const refused = typeof click === 'string' && click.includes('outside')
        expect(pointOffScreenNote({ x, y }, phone) !== null, `(${x}, ${y})`).toBe(refused)
        if (refused) outside++
      }
    }
    // Both answers occur, so the agreement is not two functions that always say the same thing.
    expect(outside).toBeGreaterThan(0)
    expect(outside).toBeLessThan(edges.length * edges.length)
  })
})

describe('an element that is not drawn', () => {
  const noteOf = (report: InspectReport): string | undefined =>
    inspectReadout(report, screenOf('laptop-768'), panelOf('reference')).notes.find(n => n.includes('not drawn'))

  it('says nothing for the ordinary case, where the element is on the screen', () => {
    expect(noteOf({ ...grey, hidden: null })).toBeUndefined()
  })

  it('names the rule, and says the figures below it are not about anything a reader sees', () => {
    const none = noteOf({ ...grey, hidden: 'display' })!
    expect(none).toContain('display: none')
    expect(none).toContain('on it or on an ancestor')
    expect(none).toContain('the contrast verdict is not a verdict about anything a reader sees')
    expect(noteOf({ ...grey, hidden: 'visibility' })!).toContain('visibility: hidden')
  })

  it('comes first, before the notes about the figures themselves', () => {
    // A reader who stops at the first note has to learn this one, not the
    // layout scale: nothing below it describes anything on the screen.
    const r = inspectReadout({ ...grey, hidden: 'display', color: [0, 0, 0, 0.5] }, screenOf('laptop-768'), panelOf('reference'))
    expect(r.notes.length).toBeGreaterThan(1)
    expect(r.notes[0]).toContain('not drawn')
  })

  it('keeps the measurements: the selector matched, and what the element would be is a fair question', () => {
    const r = inspectReadout({ ...grey, hidden: 'display' }, screenOf('laptop-768'), panelOf('reference'))
    expect(r.font.px).toBe(13)
    expect(r.contrast).not.toBeNull()
  })
})

describe('invalidSelectorNote', () => {
  it('quotes the selector and says what found: false does and does not mean', () => {
    const note = invalidSelectorNote('p[')
    expect(note).toContain('"p[" is not a valid CSS selector')
    expect(note).toContain('nothing was looked for')
    expect(note).toContain('found: false is about the selector, not the page')
  })

  it('names the causes an agent actually hits, and does not warn off valid CSS', () => {
    // Measured against the engine in tests/browser/inspect.test.ts: `:has()`
    // and `:is()` are accepted, `:contains()` is not.
    const note = invalidSelectorNote('p:contains("x")')
    expect(note).toContain(':contains()')
    expect(note).toContain(':has() and :is() are valid CSS and are accepted')
  })
})
