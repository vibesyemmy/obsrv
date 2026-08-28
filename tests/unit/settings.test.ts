import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadSettings, saveSettings } from '../../src/shared/settings'
import { DEFAULT_SETTINGS } from '../../src/shared/presets'

const dir = () => mkdtempSync(join(tmpdir(), 'obsrv-'))

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
