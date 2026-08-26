import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import {
  CONTROL_COMMANDS,
  HIGHLIGHT_DURATION_DEFAULT_MS,
  HIGHLIGHT_DURATION_MAX_MS,
  HIGHLIGHT_DURATION_MIN_MS,
  controlFileModeOk,
  defaultControlFilePath,
  isControlCommand,
  parseClick,
  parseControlFile,
  parseControlStatus,
  parseHighlight,
  pixelExactApplyError,
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
  it('knows exactly the sixteen commands', () => {
    expect([...CONTROL_COMMANDS].sort()).toEqual([
      'back',
      'captureTarget',
      'captureVisible',
      'click',
      'focusWindow',
      'forward',
      'highlight',
      'navigate',
      'panTo',
      'reload',
      'scroll',
      'setPixelExact',
      'setPreset',
      'setProfile',
      'setViewMode',
      'status',
    ])
    expect(isControlCommand('status')).toBe(true)
    expect(isControlCommand('click')).toBe(true)
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

  it('pixelExactApplyError: exactly the two booleans', () => {
    expect(pixelExactApplyError(true)).toBeNull()
    expect(pixelExactApplyError(false)).toBeNull()
    expect(pixelExactApplyError(1)).toMatch(/on: boolean/)
    expect(pixelExactApplyError('true')).toMatch(/on: boolean/)
    expect(pixelExactApplyError(undefined)).toMatch(/on: boolean/)
  })
})

describe('parseClick', () => {
  const vp = { width: 1366, height: 768 }
  it('accepts an in-viewport click and defaults the button to left', () => {
    expect(parseClick({ x: 100, y: 50 }, vp)).toEqual({ x: 100, y: 50, button: 'left' })
  })
  it('accepts the in-viewport edges and every named button', () => {
    expect(parseClick({ x: 0, y: 0, button: 'middle' }, vp)).toEqual({ x: 0, y: 0, button: 'middle' })
    expect(parseClick({ x: 1365.5, y: 767.5, button: 'right' }, vp)).toEqual({ x: 1365.5, y: 767.5, button: 'right' })
  })
  it('rejects a click outside the current CSS viewport, naming it', () => {
    const err = parseClick({ x: 1367, y: 10 }, vp)
    expect(err).toMatch(/outside the current CSS viewport 1366x768/)
    expect(parseClick({ x: 10, y: 769 }, vp)).toMatch(/outside/)
    expect(parseClick({ x: -1, y: 10 }, vp)).toMatch(/outside/)
  })
  it('rejects the exact viewport size: pixel row width/height is the first one outside', () => {
    expect(parseClick({ x: 1366, y: 10 }, vp)).toMatch(/outside/)
    expect(parseClick({ x: 10, y: 768 }, vp)).toMatch(/outside/)
  })
  it.each([
    ['not an object', 'click'],
    ['missing y', { x: 10 }],
    ['NaN', { x: NaN, y: 0 }],
    ['Infinity', { x: 0, y: Infinity }],
    ['string coordinate', { x: '10', y: 10 }],
  ])('rejects %s with the shape message', (_name, raw) => {
    expect(parseClick(raw, vp)).toMatch(/must be \{ x, y, button\? \}/)
  })
  it('rejects an unknown button', () => {
    expect(parseClick({ x: 1, y: 1, button: 'back' }, vp)).toMatch(/left, middle or right/)
  })
})

describe('parseHighlight', () => {
  it('accepts a rect and defaults the duration', () => {
    expect(parseHighlight({ x: 10, y: 20, width: 300, height: 80 })).toEqual({
      x: 10,
      y: 20,
      width: 300,
      height: 80,
      durationMs: HIGHLIGHT_DURATION_DEFAULT_MS,
    })
  })
  it('rounds coordinates like a pane rect and never passes unknown keys through', () => {
    expect(parseHighlight({ x: 10.4, y: 19.6, width: 300, height: 80, durationMs: 500, extra: 1 })).toEqual({
      x: 10,
      y: 20,
      width: 300,
      height: 80,
      durationMs: 500,
    })
  })
  it('clamps the duration into 250-10000 ms and rounds it', () => {
    expect(parseHighlight({ x: 0, y: 0, width: 1, height: 1, durationMs: 1 })).toMatchObject({
      durationMs: HIGHLIGHT_DURATION_MIN_MS,
    })
    expect(parseHighlight({ x: 0, y: 0, width: 1, height: 1, durationMs: 60_000 })).toMatchObject({
      durationMs: HIGHLIGHT_DURATION_MAX_MS,
    })
    expect(parseHighlight({ x: 0, y: 0, width: 1, height: 1, durationMs: 999.6 })).toMatchObject({ durationMs: 1000 })
  })
  it('rejects a non-numeric duration rather than guessing', () => {
    expect(parseHighlight({ x: 0, y: 0, width: 1, height: 1, durationMs: '2000' })).toMatch(/durationMs/)
    expect(parseHighlight({ x: 0, y: 0, width: 1, height: 1, durationMs: NaN })).toMatch(/durationMs/)
  })
  it('rejects a rect that would be invisible', () => {
    expect(parseHighlight({ x: 0, y: 0, width: 0, height: 10 })).toMatch(/at least 1x1/)
    expect(parseHighlight({ x: 0, y: 0, width: 10, height: 0.2 })).toMatch(/at least 1x1/)
  })
  it.each([
    ['not an object', 'rect'],
    ['missing fields', { x: 0, y: 0 }],
    ['NaN', { x: NaN, y: 0, width: 1, height: 1 }],
    ['negative origin', { x: -1, y: 0, width: 1, height: 1 }],
    ['absurd size', { x: 0, y: 0, width: 16385, height: 1 }],
  ])('rejects %s with the shape message', (_name, raw) => {
    expect(parseHighlight(raw)).toMatch(/highlight payload must be/)
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
