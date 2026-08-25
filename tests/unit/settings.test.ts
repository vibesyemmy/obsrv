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
    expect(loadSettings(f)).toEqual({ hostDiagonalInches: 32, hostNits: 500, agentControl: false })
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
  it('round-trips and creates parent dirs', () => {
    const f = join(dir(), 'nested', 'settings.json')
    saveSettings(f, { hostDiagonalInches: 24, hostNits: 350, agentControl: true })
    expect(JSON.parse(readFileSync(f, 'utf8'))).toEqual({ hostDiagonalInches: 24, hostNits: 350, agentControl: true })
    expect(loadSettings(f)).toEqual({ hostDiagonalInches: 24, hostNits: 350, agentControl: true })
  })
})
