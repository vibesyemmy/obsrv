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
      split: 0.5,
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
      split: 0.5,
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
      split: 0.72,
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
})
