import { describe, expect, it } from 'vitest'
import { MOTION_FLOOR_PX, auditBoxes, boxesMoved, lintBoxes, motionAfter, pageMovedNote } from '../../src/shared/pageMotion'

const box = (element: string, x: number, y: number) => ({ element, rect: { x, y, width: 10, height: 10 } })

describe('boxesMoved', () => {
  it('finds nothing on a page that held still', () => {
    const boxes = [box('a', 0, 0), box('b', 0, 50)]
    expect(boxesMoved(boxes, boxes)).toEqual({ moved: 0, compared: 2, maxPx: 0, changed: 0 })
  })

  it('reports how far the furthest one travelled', () => {
    const before = [box('a', 0, 0), box('b', 0, 50)]
    const after = [box('a', 0, 12), box('b', 0, 488)]
    const m = boxesMoved(before, after)
    expect(m).toMatchObject({ moved: 2, compared: 2, maxPx: 438 })
  })

  it('ignores sub-pixel jitter, which a re-measure of a still page produces', () => {
    const before = [box('a', 10.0625, 20.5)]
    const after = [box('a', 10.0624, 20.5003)]
    expect(boxesMoved(before, after).moved).toBe(0)
    expect(MOTION_FLOOR_PX).toBe(1)
  })

  it('pairs repeated elements by ordinal, so the nth card is the nth card', () => {
    const before = [box('div.card', 0, 0), box('div.card', 0, 100), box('div.card', 0, 200)]
    // The middle one moved; matching by element name alone would pair them wrongly.
    const after = [box('div.card', 0, 0), box('div.card', 0, 140), box('div.card', 0, 200)]
    expect(boxesMoved(before, after)).toMatchObject({ moved: 1, compared: 3, maxPx: 40 })
  })

  it('counts elements that arrived or left as the page rewriting itself', () => {
    const before = [box('a', 0, 0), box('gone', 0, 10)]
    const after = [box('a', 0, 0), box('arrived', 0, 10)]
    expect(boxesMoved(before, after)).toMatchObject({ moved: 0, compared: 1, changed: 2 })
  })

  it('compares only what both passes hold, so a shrunken page is not all movement', () => {
    const before = [box('a', 0, 0), box('b', 0, 50), box('c', 0, 100)]
    const after = [box('a', 0, 0)]
    expect(boxesMoved(before, after)).toMatchObject({ moved: 0, compared: 1, changed: 2 })
  })
})

describe('pageMovedNote', () => {
  it('says nothing about a page that painted without moving anything', () => {
    // A playing video and an opacity fade both answer `animating`; neither
    // makes the figures any less repeatable, so neither earns a sentence.
    expect(pageMovedNote('audit', { moved: 0, compared: 700, maxPx: 0, changed: 0 }, 300)).toBeNull()
  })

  it('names its own numbers and the interval they are over', () => {
    const note = pageMovedNote('audit', { moved: 96, compared: 97, maxPx: 438, changed: 0 }, 312)
    expect(note).toContain('96 of the 97 elements re-measured had moved')
    expect(note).toContain('438 CSS px')
    expect(note).toContain('312 ms')
    expect(note).toContain('a repeat run will not agree on them')
  })

  it('names replacement separately from movement', () => {
    const note = pageMovedNote('lint', { moved: 0, compared: 40, maxPx: 0, changed: 12 }, 200)
    expect(note).toContain('12 had been replaced')
    expect(note).not.toContain('elements re-measured had moved')
    expect(note).toContain('The lint is of one moment')
  })

  it('fires on replacement alone, since a page that swapped its content moved most of all', () => {
    expect(pageMovedNote('audit', { moved: 0, compared: 0, maxPx: 0, changed: 5 }, 100)).not.toBeNull()
  })
})

describe('the adapters take the boxes the measurement already holds', () => {
  it('audit compares targets and text together', () => {
    expect(auditBoxes({ targets: [box('button', 0, 0)], text: [box('p', 0, 20)] })).toHaveLength(2)
  })

  it('lint compares text, edges and images together', () => {
    expect(lintBoxes({ text: [box('p', 0, 0)], edges: [box('hr', 0, 5)], images: [box('img', 0, 10)] })).toHaveLength(3)
  })
})

describe('motionAfter', () => {
  const boxesOf = (r: { boxes: ReturnType<typeof box>[] }) => r.boxes

  it('waits, re-measures, and reports the interval it actually took', async () => {
    let clock = 1000
    const slept: number[] = []
    const m = await motionAfter(
      [box('a', 0, 0)],
      async () => ({ boxes: [box('a', 0, 40)] }),
      boxesOf,
      250,
      async ms => {
        slept.push(ms)
        clock += ms
      },
      () => clock,
    )
    expect(slept).toEqual([250])
    expect(m).toMatchObject({ moved: 1, compared: 1, maxPx: 40, afterMs: 250 })
  })

  it('reports the real interval when a caller reuses another probe\'s wait', async () => {
    // render() runs audit then lint off one wait: the lint comparison spans
    // that wait plus the audit re-measure, and quoting the constant would
    // understate it.
    let clock = 0
    const m = await motionAfter(
      [box('a', 0, 0)],
      async () => {
        clock += 15
        return { boxes: [box('a', 0, 9)] }
      },
      boxesOf,
      0,
      async ms => {
        clock += ms
      },
      () => clock,
    )
    expect(m?.afterMs).toBe(15)
  })

  it('gives back nothing when the page stopped answering', async () => {
    // The caller's own timeout note covers that case; this one stays quiet
    // rather than inventing a comparison against half a page.
    const m = await motionAfter([box('a', 0, 0)], async () => null, boxesOf, 0, async () => {})
    expect(m).toBeNull()
  })
})
