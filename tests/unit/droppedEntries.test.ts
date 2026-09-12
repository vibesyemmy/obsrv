import { describe, expect, it } from 'vitest'
import { droppedEntriesNote } from '../../src/shared/droppedEntries'

/**
 * What the reader is told when the checks refused an entry. Before 0.55.0 a
 * refused value cost the whole report; now it costs itself, and the count is
 * the only thing standing between a systematic fault and a page that merely
 * looks thin.
 */
describe('droppedEntriesNote', () => {
  it('says nothing when nothing was dropped', () => {
    expect(droppedEntriesNote(undefined, { text: 415 })).toBeNull()
    expect(droppedEntriesNote({}, { text: 415 })).toBeNull()
  })

  it('names the count, the total and the kind', () => {
    const note = droppedEntriesNote({ text: 3 }, { text: 415 })!
    expect(note).toContain('3 of 415 text elements')
    expect(note).toContain('outside what the measurement accepts')
    expect(note).toContain('the figures below are of the rest')
  })

  it('counts one in the singular', () => {
    expect(droppedEntriesNote({ text: 1 }, { text: 40 })).toContain('1 of 40 text elements')
    expect(droppedEntriesNote({ images: 1 }, { images: 9 })).toContain('1 of 9 images')
  })

  it('joins the kinds when more than one lost something', () => {
    const note = droppedEntriesNote({ text: 3, images: 1 }, { text: 415, images: 9 })!
    expect(note).toContain('3 of 415 text elements and 1 of 9 images')
  })

  it('counts the total as what the page sent, not what survived', () => {
    // 415 kept plus 3 dropped: the reader is told the denominator they'd expect.
    expect(droppedEntriesNote({ targets: 2 }, { targets: 118 })).toContain('2 of 118 targets')
  })
})
