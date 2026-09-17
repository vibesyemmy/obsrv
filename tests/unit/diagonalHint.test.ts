import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../../src/shared/presets'
import { diagonalHint, diagonalHintWords, recordDiagonalFor, type DiagonalHint } from '../../src/shared/diagonalHint'
import type { HostInfo, Settings } from '../../src/shared/types'

const laptop: HostInfo = { physicalWidth: 3024, physicalHeight: 1964, scaleFactor: 2 }
const monitor: HostInfo = { physicalWidth: 3840, physicalHeight: 2160, scaleFactor: 2 }
const unknownHost: HostInfo = { physicalWidth: 0, physicalHeight: 0, scaleFactor: 0 }
const settings = (over: Partial<Settings>): Settings => ({ ...DEFAULT_SETTINGS, ...over })

describe('diagonalHint: whether the diagonal is known to be this screen’s', () => {
  it('speaks when nobody has set the diagonal', () => {
    expect(diagonalHint(settings({}), laptop)).toEqual({ kind: 'untouched', inches: 27 })
  })

  it('speaks when the diagonal was set before Obsrv recorded which screen it was for', () => {
    expect(diagonalHint(settings({ hostDiagonalInches: 24, hostDiagonalSetFor: 'unknown' }), laptop)).toEqual({ kind: 'unknown-screen', inches: 24 })
  })

  it('is silent only when the diagonal was set for the display the window is on', () => {
    const set = settings({ hostDiagonalInches: 13.3, hostDiagonalSetFor: [{ physicalWidth: 3024, physicalHeight: 1964 }] })
    expect(diagonalHint(set, laptop)).toEqual({ kind: 'none' })
    // The same file on another display names both, rather than going quiet.
    expect(diagonalHint(set, monitor)).toEqual({
      kind: 'other-display',
      inches: 13.3,
      setFor: { physicalWidth: 3024, physicalHeight: 1964 },
      current: { physicalWidth: 3840, physicalHeight: 2160 },
    })
  })

  it('says nothing while the display is unknown, since there is nothing to compare against', () => {
    expect(diagonalHint(settings({}), unknownHost)).toEqual({ kind: 'none' })
  })

  it('confirming records this display and leaves the number alone, which ends the hint here', () => {
    const before = settings({ hostDiagonalInches: 24, hostDiagonalSetFor: 'unknown' })
    const after = recordDiagonalFor(before, laptop)
    expect(after.hostDiagonalInches).toBe(24)
    expect(after.hostDiagonalSetFor).toEqual([{ physicalWidth: 3024, physicalHeight: 1964 }])
    expect(diagonalHint(after, laptop)).toEqual({ kind: 'none' })
    // Recording replaces, under the one-diagonal rule: the other screen is now the mismatched one.
    expect(diagonalHint(after, monitor).kind).toBe('other-display')
  })

  it('records nothing while the display is unknown, rather than guessing one', () => {
    const before = settings({ hostDiagonalSetFor: 'unknown' })
    expect(recordDiagonalFor(before, unknownHost)).toBe(before)
  })
})

describe('diagonalHintWords: what the footer chip says', () => {
  const words = (h: DiagonalHint) => diagonalHintWords(h as Exclude<DiagonalHint, { kind: 'none' }>)

  it('names the assumed size, and every state offers a way to answer rather than a bare dismissal', () => {
    const untouched = words(diagonalHint(settings({}), laptop))
    expect(untouched.message).toBe('this render assumes a 27″ screen, the default, so it is not at true physical size unless this screen is 27″')
    expect(untouched.confirm).toBe('27″ is right')

    const unknown = words(diagonalHint(settings({ hostDiagonalInches: 24, hostDiagonalSetFor: 'unknown' }), laptop))
    expect(unknown.message).toBe('24″ was set before Obsrv recorded which screen it was for')
    expect(unknown.confirm).toBe('Right for this screen')

    const other = words(diagonalHint(settings({ hostDiagonalInches: 13.3, hostDiagonalSetFor: [{ physicalWidth: 3024, physicalHeight: 1964 }] }), monitor))
    expect(other.message).toBe('screen size was set on a 3024×1964 display; this one is 3840×2160, so this render assumes 13.3″')
    expect(other.confirm).toBe('13.3″ is right here')

    for (const w of [untouched, unknown, other]) expect(w.set.length).toBeGreaterThan(0)
  })
})
