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
    expect(() => saveSettings(join(dir(), 's.json'), { hostDiagonalInches: 0, hostNits: 500, agentControl: false })).toThrow(RangeError)
    expect(() => saveSettings(join(dir(), 's.json'), { hostDiagonalInches: 27, hostNits: NaN, agentControl: false })).toThrow(RangeError)
    expect(() =>
      saveSettings(join(dir(), 's.json'), { hostDiagonalInches: 27, hostNits: 500, agentControl: 'yes' as unknown as boolean }),
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
    }
    saveSettings(f, full)
    expect(JSON.parse(readFileSync(f, 'utf8'))).toEqual(full)
    expect(loadSettings(f)).toEqual(full)
  })
})
