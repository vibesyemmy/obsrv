import { afterEach, describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadSettings, saveSettings } from '../../src/shared/settings'
import { DEFAULT_SETTINGS } from '../../src/shared/presets'

// Every temp dir is tracked and removed after each test: a run through a
// sandbox whose TMPDIR is the repo root (the agent tooling's) leaked one
// directory per call into the working tree, and an OS temp dir fills up just
// as surely. Same pattern as tabsFile.test.ts.
const dirs: string[] = []
const dir = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'obsrv-'))
  dirs.push(d)
  return d
}
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true })
})

describe('settings', () => {
  it('returns defaults when file is missing', () => {
    expect(loadSettings(join(dir(), 'nope.json'))).toEqual(DEFAULT_SETTINGS)
  })
  it('returns defaults when file is corrupt', () => {
    const f = join(dir(), 'settings.json')
    writeFileSync(f, '{not json')
    expect(loadSettings(f)).toEqual(DEFAULT_SETTINGS)
  })
  it('merges valid numeric fields over defaults and ignores junk', () => {
    const f = join(dir(), 'settings.json')
    writeFileSync(f, JSON.stringify({ hostDiagonalInches: 32, hostNits: 'bad', extra: 1 }))
    expect(loadSettings(f)).toEqual({
      hostDiagonalInches: 32,
      // A chosen diagonal in a file older than the field: set, for a screen
      // nobody recorded (see the migration tests below).
      hostDiagonalSetFor: 'unknown',
      hostNits: 500,
      agentControl: false,
      updateCheck: true,
      lastUpdateCheck: 0,
      recordHistory: true,
      split: 0.5,
      maxTabs: 12,
    })
  })
  it('reads agentControl only as a literal true — anything else stays off', () => {
    const f = join(dir(), 'settings.json')
    writeFileSync(f, JSON.stringify({ hostDiagonalInches: 27, hostNits: 500, agentControl: true }))
    expect(loadSettings(f).agentControl).toBe(true)
    writeFileSync(f, JSON.stringify({ hostDiagonalInches: 27, hostNits: 500, agentControl: 1 }))
    expect(loadSettings(f).agentControl).toBe(false)
  })
  it('refuses to save invalid values', () => {
    expect(() => saveSettings(join(dir(), 's.json'), { ...DEFAULT_SETTINGS, hostDiagonalInches: 0 })).toThrow(RangeError)
    expect(() => saveSettings(join(dir(), 's.json'), { ...DEFAULT_SETTINGS, hostNits: NaN })).toThrow(RangeError)
    expect(() =>
      saveSettings(join(dir(), 's.json'), { ...DEFAULT_SETTINGS, agentControl: 'yes' as unknown as boolean }),
    ).toThrow(RangeError)
    expect(() =>
      saveSettings(join(dir(), 's.json'), { ...DEFAULT_SETTINGS, recordHistory: 1 as unknown as boolean }),
    ).toThrow(RangeError)
  })
  it('defaults the update fields when an older file has neither key', () => {
    const f = join(dir(), 'settings.json')
    writeFileSync(f, JSON.stringify({ hostDiagonalInches: 27, hostNits: 500, agentControl: false }))
    expect(loadSettings(f)).toEqual({
      hostDiagonalInches: 27,
      hostDiagonalSetFor: [],
      hostNits: 500,
      agentControl: false,
      updateCheck: true,
      lastUpdateCheck: 0,
      recordHistory: true,
      split: 0.5,
      maxTabs: 12,
    })
  })

  it('keeps an explicit updateCheck: false and refuses a non-boolean', () => {
    const f = join(dir(), 'settings.json')
    writeFileSync(f, JSON.stringify({ hostDiagonalInches: 27, hostNits: 500, updateCheck: false }))
    expect(loadSettings(f).updateCheck).toBe(false)
    // Unlike agentControl, the safe default here is on, so only a literal
    // false turns it off; anything else falls back to the default.
    writeFileSync(f, JSON.stringify({ hostDiagonalInches: 27, hostNits: 500, updateCheck: 0 }))
    expect(loadSettings(f).updateCheck).toBe(true)
  })

  it('keeps an explicit recordHistory: false and refuses a non-boolean', () => {
    const f = join(dir(), 'settings.json')
    writeFileSync(f, JSON.stringify({ hostDiagonalInches: 27, hostNits: 500, recordHistory: false }))
    expect(loadSettings(f).recordHistory).toBe(false)
    // On by default like updateCheck, so only a literal false turns it off.
    writeFileSync(f, JSON.stringify({ hostDiagonalInches: 27, hostNits: 500, recordHistory: 0 }))
    expect(loadSettings(f).recordHistory).toBe(true)
  })

  it('keeps a sane lastUpdateCheck and discards a bad one', () => {
    const f = join(dir(), 'settings.json')
    writeFileSync(f, JSON.stringify({ hostDiagonalInches: 27, hostNits: 500, lastUpdateCheck: 1700000000000 }))
    expect(loadSettings(f).lastUpdateCheck).toBe(1700000000000)
    writeFileSync(f, JSON.stringify({ hostDiagonalInches: 27, hostNits: 500, lastUpdateCheck: 'soon' }))
    expect(loadSettings(f).lastUpdateCheck).toBe(0)
  })

  it('round-trips and creates parent dirs', () => {
    const f = join(dir(), 'nested', 'settings.json')
    const full = {
      hostDiagonalInches: 24,
      hostDiagonalSetFor: [{ physicalWidth: 3024, physicalHeight: 1964 }],
      hostNits: 350,
      agentControl: true,
      updateCheck: false,
      lastUpdateCheck: 1700000000000,
      recordHistory: false,
      split: 0.72,
      maxTabs: 6,
    }
    saveSettings(f, full)
    expect(JSON.parse(readFileSync(f, 'utf8'))).toEqual(full)
    expect(loadSettings(f)).toEqual(full)
  })
  // `hostDiagonalSetFor`: which display the diagonal was set for. An older
  // file has no key, and always has a diagonal, because saveSettings writes
  // the whole object: the number alone cannot say whether anyone chose it.
  it('reads an older file holding the default diagonal as untouched, so the hint shows', () => {
    const f = join(dir(), 'settings.json')
    writeFileSync(f, JSON.stringify({ hostDiagonalInches: 27, hostNits: 500, lastUpdateCheck: 1700000000000 }))
    expect(loadSettings(f).hostDiagonalSetFor).toEqual([])
  })
  it('reads an older file holding a chosen diagonal as set for an unknown screen, never as silently set for this one', () => {
    // Henry's rule (2026-09-17): adopting 24″ for whichever screen opens first
    // is silent exactly when that screen is not the one it was set for.
    const f = join(dir(), 'settings.json')
    writeFileSync(f, JSON.stringify({ hostDiagonalInches: 24, hostNits: 500 }))
    expect(loadSettings(f).hostDiagonalSetFor).toBe('unknown')
  })
  it('keeps a recorded display, and an explicit unknown, as written', () => {
    const f = join(dir(), 'settings.json')
    const d = { physicalWidth: 3024, physicalHeight: 1964 }
    writeFileSync(f, JSON.stringify({ hostDiagonalInches: 13.3, hostNits: 500, hostDiagonalSetFor: [d] }))
    expect(loadSettings(f).hostDiagonalSetFor).toEqual([d])
    writeFileSync(f, JSON.stringify({ hostDiagonalInches: 27, hostNits: 500, hostDiagonalSetFor: 'unknown' }))
    expect(loadSettings(f).hostDiagonalSetFor).toBe('unknown')
    // An explicit empty list is a file that says "untouched", even beside a
    // chosen-looking number: the key is the record, the number is not.
    writeFileSync(f, JSON.stringify({ hostDiagonalInches: 24, hostNits: 500, hostDiagonalSetFor: [] }))
    expect(loadSettings(f).hostDiagonalSetFor).toEqual([])
  })
  it('reads a hand-edited, unreadable value like a missing one, erring towards the hint rather than silence', () => {
    const f = join(dir(), 'settings.json')
    writeFileSync(f, JSON.stringify({ hostDiagonalInches: 24, hostNits: 500, hostDiagonalSetFor: 'the big one' }))
    expect(loadSettings(f).hostDiagonalSetFor).toBe('unknown')
    writeFileSync(f, JSON.stringify({ hostDiagonalInches: 27, hostNits: 500, hostDiagonalSetFor: [{ physicalWidth: -1, physicalHeight: 900 }] }))
    expect(loadSettings(f).hostDiagonalSetFor).toEqual([])
    // Valid entries survive beside junk, and the list is held to its bound.
    const d = { physicalWidth: 1920, physicalHeight: 1080 }
    writeFileSync(f, JSON.stringify({ hostDiagonalInches: 24, hostNits: 500, hostDiagonalSetFor: ['x', d, ...Array(9).fill(d)] }))
    expect(loadSettings(f).hostDiagonalSetFor).toHaveLength(8)
  })
  it('refuses to save a hostDiagonalSetFor that is not a recorded display list or unknown', () => {
    const f = join(dir(), 'settings.json')
    const base = { ...DEFAULT_SETTINGS }
    expect(() => saveSettings(f, { ...base, hostDiagonalSetFor: [{ physicalWidth: 1920.5, physicalHeight: 1080 }] })).toThrow(RangeError)
    expect(() => saveSettings(f, { ...base, hostDiagonalSetFor: Array(9).fill({ physicalWidth: 1, physicalHeight: 1 }) })).toThrow(RangeError)
    expect(() => saveSettings(f, { ...base, hostDiagonalSetFor: 'somewhere' as never })).toThrow(RangeError)
    // `inches` is allowed from day one, so a diagonal per display is additive.
    expect(() => saveSettings(f, { ...base, hostDiagonalSetFor: [{ physicalWidth: 1920, physicalHeight: 1080, inches: 24 }] })).not.toThrow()
  })
  it('keeps a split inside the band and treats one outside it as absent', () => {
    const f = join(dir(), 'settings.json')
    writeFileSync(f, JSON.stringify({ hostDiagonalInches: 27, hostNits: 500, split: 0.72 }))
    expect(loadSettings(f).split).toBe(0.72)
    // The band's own edges are inside it.
    for (const v of [0.1, 0.9]) {
      writeFileSync(f, JSON.stringify({ hostDiagonalInches: 27, hostNits: 500, split: v }))
      expect(loadSettings(f).split).toBe(v)
    }
    // Outside the band, absent, or not a number at all: an even split. Not a
    // clamp to the nearest edge — a file claiming 0.97 is not evidence of an
    // intent worth honouring at 0.9.
    for (const v of [0.05, 0.97, 0, 1, -0.5, 'wide', null, NaN]) {
      writeFileSync(f, JSON.stringify({ hostDiagonalInches: 27, hostNits: 500, split: v }))
      expect(loadSettings(f).split).toBe(0.5)
    }
    writeFileSync(f, JSON.stringify({ hostDiagonalInches: 27, hostNits: 500 }))
    expect(loadSettings(f).split).toBe(0.5)
  })

  it('refuses to save a split outside the band', () => {
    for (const v of [0.05, 0.97, NaN, Infinity, 0]) {
      expect(() => saveSettings(join(dir(), 's.json'), { ...DEFAULT_SETTINGS, split: v })).toThrow(RangeError)
    }
    expect(() =>
      saveSettings(join(dir(), 's.json'), { ...DEFAULT_SETTINGS, split: '0.7' as unknown as number }),
    ).toThrow(RangeError)
  })

  it('round-trips a split through disk', () => {
    const f = join(dir(), 'settings.json')
    saveSettings(f, { ...DEFAULT_SETTINGS, split: 0.68 })
    expect(loadSettings(f).split).toBe(0.68)
    // And the file really carries it, rather than the reader inventing it.
    expect(JSON.parse(readFileSync(f, 'utf8')).split).toBe(0.68)
  })

  it('keeps a maxTabs inside the band, including its edges', () => {
    const f = join(dir(), 'settings.json')
    writeFileSync(f, JSON.stringify({ hostDiagonalInches: 27, hostNits: 500, maxTabs: 4 }))
    expect(loadSettings(f).maxTabs).toBe(4)
    for (const v of [2, 32]) {
      writeFileSync(f, JSON.stringify({ hostDiagonalInches: 27, hostNits: 500, maxTabs: v }))
      expect(loadSettings(f).maxTabs).toBe(v)
    }
  })

  it('defaults maxTabs when an older file has no key', () => {
    const f = join(dir(), 'settings.json')
    writeFileSync(f, JSON.stringify({ hostDiagonalInches: 27, hostNits: 500 }))
    expect(loadSettings(f).maxTabs).toBe(12)
  })

  it('clamps a maxTabs below the band up to the floor, rather than to the default', () => {
    // Unlike the split, a cap is ordered: someone who typed 1 wants fewer
    // tabs, and answering with 12 reverts them to a number they rejected.
    const f = join(dir(), 'settings.json')
    for (const v of [1, 0, -4]) {
      writeFileSync(f, JSON.stringify({ hostDiagonalInches: 27, hostNits: 500, maxTabs: v }))
      expect(loadSettings(f).maxTabs).toBe(2)
    }
  })

  it('clamps a maxTabs above the band down to the ceiling, rather than to the default', () => {
    const f = join(dir(), 'settings.json')
    for (const v of [33, 999]) {
      writeFileSync(f, JSON.stringify({ hostDiagonalInches: 27, hostNits: 500, maxTabs: v }))
      expect(loadSettings(f).maxTabs).toBe(32)
    }
  })

  it('falls back for a maxTabs that carries no direction to honour', () => {
    // A fraction or a string is not "more tabs" or "fewer tabs", it is
    // nonsense, and there is nothing in it to clamp towards.
    const f = join(dir(), 'settings.json')
    for (const v of [4.5, 12.5, 'lots', null, true, NaN]) {
      writeFileSync(f, JSON.stringify({ hostDiagonalInches: 27, hostNits: 500, maxTabs: v }))
      expect(loadSettings(f).maxTabs).toBe(12)
    }
  })

  it('refuses to save a maxTabs outside the band', () => {
    for (const v of [1, 33, 12.5, NaN, Infinity]) {
      expect(() => saveSettings(join(dir(), 's.json'), { ...DEFAULT_SETTINGS, maxTabs: v })).toThrow(RangeError)
    }
    expect(() =>
      saveSettings(join(dir(), 's.json'), { ...DEFAULT_SETTINGS, maxTabs: '8' as unknown as number }),
    ).toThrow(RangeError)
  })

  it('round-trips a maxTabs through disk', () => {
    const f = join(dir(), 'settings.json')
    saveSettings(f, { ...DEFAULT_SETTINGS, maxTabs: 6 })
    expect(loadSettings(f).maxTabs).toBe(6)
    // And the file really carries it, rather than the reader inventing it.
    expect(JSON.parse(readFileSync(f, 'utf8')).maxTabs).toBe(6)
  })
})
