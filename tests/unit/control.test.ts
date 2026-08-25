import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import {
  CONTROL_COMMANDS,
  controlFileModeOk,
  defaultControlFilePath,
  isControlCommand,
  parseControlFile,
  parseControlStatus,
  presetApplyError,
  profileApplyError,
  tokenEqual,
  viewModeApplyError,
} from '../../src/shared/control'
import { PANEL_PROFILES, SCREEN_PRESETS } from '../../src/shared/presets'

const TOKEN = 'ab'.repeat(32) // 64 hex chars

describe('parseControlFile', () => {
  it('accepts a well-formed discovery file', () => {
    expect(parseControlFile(JSON.stringify({ port: 49152, token: TOKEN }))).toEqual({ port: 49152, token: TOKEN })
  })
  it.each([
    ['not JSON', '{nope'],
    ['not an object', '"str"'],
    ['missing port', JSON.stringify({ token: TOKEN })],
    ['port 0', JSON.stringify({ port: 0, token: TOKEN })],
    ['port too high', JSON.stringify({ port: 65536, token: TOKEN })],
    ['fractional port', JSON.stringify({ port: 80.5, token: TOKEN })],
    ['port as string', JSON.stringify({ port: '8080', token: TOKEN })],
    ['short token', JSON.stringify({ port: 8080, token: 'abc123' })],
    ['non-hex token', JSON.stringify({ port: 8080, token: 'zz'.repeat(32) })],
    ['uppercase token', JSON.stringify({ port: 8080, token: TOKEN.toUpperCase() })],
    ['missing token', JSON.stringify({ port: 8080 })],
  ])('rejects %s', (_name, raw) => {
    expect(parseControlFile(raw)).toBeNull()
  })
})

describe('controlFileModeOk', () => {
  it('accepts 0600 and rejects any group/other access on POSIX', () => {
    expect(controlFileModeOk(0o100600, 'darwin')).toBe(true)
    expect(controlFileModeOk(0o100644, 'darwin')).toBe(false)
    expect(controlFileModeOk(0o100640, 'linux')).toBe(false)
    expect(controlFileModeOk(0o100604, 'linux')).toBe(false)
  })
  it('passes everything on win32 (no POSIX bits to read)', () => {
    expect(controlFileModeOk(0o100666, 'win32')).toBe(true)
  })
})

describe('tokenEqual', () => {
  it('matches only the exact token', () => {
    expect(tokenEqual(TOKEN, TOKEN)).toBe(true)
    expect(tokenEqual(TOKEN, 'cd'.repeat(32))).toBe(false)
  })
  it('handles length mismatches and non-strings without throwing', () => {
    expect(tokenEqual(TOKEN, TOKEN.slice(0, 10))).toBe(false)
    expect(tokenEqual(TOKEN, '')).toBe(false)
    expect(tokenEqual(TOKEN, undefined)).toBe(false)
    expect(tokenEqual(TOKEN, 12345)).toBe(false)
    expect(tokenEqual(TOKEN, { token: TOKEN })).toBe(false)
  })
})

describe('defaultControlFilePath', () => {
  it('derives the Electron userData path per platform', () => {
    expect(defaultControlFilePath('darwin', {}, '/Users/u')).toBe(
      join('/Users/u', 'Library', 'Application Support', 'Obsrv', 'control.json'),
    )
    expect(defaultControlFilePath('linux', {}, '/home/u')).toBe(join('/home/u', '.config', 'Obsrv', 'control.json'))
    expect(defaultControlFilePath('linux', { XDG_CONFIG_HOME: '/xdg' }, '/home/u')).toBe(
      join('/xdg', 'Obsrv', 'control.json'),
    )
    expect(defaultControlFilePath('win32', { APPDATA: 'C:\\ad' }, 'C:\\Users\\u')).toBe(
      join('C:\\ad', 'Obsrv', 'control.json'),
    )
  })
})

describe('command validation', () => {
  it('knows exactly the six commands', () => {
    expect([...CONTROL_COMMANDS].sort()).toEqual([
      'captureVisible',
      'navigate',
      'setPreset',
      'setProfile',
      'setViewMode',
      'status',
    ])
    expect(isControlCommand('status')).toBe(true)
    expect(isControlCommand('eval')).toBe(false)
    expect(isControlCommand(undefined)).toBe(false)
  })

  it('presetApplyError: accepts every real preset, refuses custom and unknowns', () => {
    for (const p of SCREEN_PRESETS) expect(presetApplyError(p.id)).toBeNull()
    expect(presetApplyError('custom')).toMatch(/custom preset cannot be applied remotely/)
    expect(presetApplyError('nope')).toMatch(/unknown preset "nope"/)
    expect(presetApplyError('nope')).toContain('laptop-768') // names the valid ids
    expect(presetApplyError(42)).toMatch(/must be/)
  })

  it('profileApplyError: accepts every profile, refuses unknowns', () => {
    for (const p of PANEL_PROFILES) expect(profileApplyError(p.id)).toBeNull()
    expect(profileApplyError('nope')).toMatch(/unknown profile/)
    expect(profileApplyError(null)).toMatch(/must be/)
  })

  it('viewModeApplyError: exactly 1:1 and fit', () => {
    expect(viewModeApplyError('1:1')).toBeNull()
    expect(viewModeApplyError('fit')).toBeNull()
    expect(viewModeApplyError('fill')).toMatch(/1:1/)
    expect(viewModeApplyError(undefined)).toMatch(/1:1/)
  })
})

describe('parseControlStatus', () => {
  const good = { version: '0.3.2', url: 'https://a.test/', presetId: 'laptop-768', profileId: 'reference', viewMode: '1:1', mode: 'url' }
  it('accepts a full status', () => {
    expect(parseControlStatus(good)).toEqual(good)
  })
  it.each([
    ['null', null],
    ['missing url', { ...good, url: undefined }],
    ['bad viewMode', { ...good, viewMode: 'fill' }],
    ['bad mode', { ...good, mode: 'video' }],
    ['numeric version', { ...good, version: 3 }],
  ])('rejects %s', (_name, raw) => {
    expect(parseControlStatus(raw)).toBeNull()
  })
})
