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
  orientationApplyError,
  panesApplyError,
  textScaleApplyError,
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
  it('knows exactly the twenty-one commands', () => {
    expect([...CONTROL_COMMANDS].sort()).toEqual([
      'back',
      'captureTarget',
      'captureVisible',
      'click',
      'focusWindow',
      'forward',
      'highlight',
      'inspect',
      'navigate',
      'panTo',
      'reload',
      'scroll',
      'setOrientation',
      'setPanes',
      'setPixelExact',
      'setPreset',
      'setProfile',
      'setTextScale',
      'setViewMode',
      'setVision',
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

  it('panesApplyError: exactly both and target', () => {
    expect(panesApplyError('both')).toBeNull()
    expect(panesApplyError('target')).toBeNull()
    expect(panesApplyError('native')).toMatch(/setPanes payload/)
    expect(panesApplyError(undefined)).toMatch(/setPanes payload/)
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

describe('orientationApplyError', () => {
  it('accepts both words', () => {
    expect(orientationApplyError('portrait')).toBeNull()
    expect(orientationApplyError('landscape')).toBeNull()
  })
  it.each([['sideways'], [90], [null], [undefined], [{}], ['']])('rejects %s and names both words', raw => {
    const err = orientationApplyError(raw)
    expect(err).toContain('portrait')
    expect(err).toContain('landscape')
  })
})

describe('parseControlStatus', () => {
  const good = {
    version: '0.3.2',
    url: 'https://a.test/',
    presetId: 'laptop-768',
    profileId: 'reference',
    viewMode: '1:1',
    mode: 'url',
    panes: 'both',
    orientation: 'portrait',
    textScale: 1,
    screenShape: 'landscape',
    cssWidth: 1366,
    cssHeight: 768,
    tabId: 'tab-3',
    tabIndex: 2,
    visionType: 'none',
    visionSeverity: 1,
  }
  it('accepts a full status', () => {
    expect(parseControlStatus(good)).toEqual(good)
  })
  it('reads panes when present', () => {
    expect(parseControlStatus({ ...good, panes: 'target' })?.panes).toBe('target')
  })
  it('reads the tab when present', () => {
    const s = parseControlStatus({ ...good, tabId: 'tab-7', tabIndex: 5 })
    expect(s).toMatchObject({ tabId: 'tab-7', tabIndex: 5 })
  })
  // Version skew is real: the MCP server is npm-installed and the app is a
  // DMG, so a new server routinely talks to an older app. An absent field
  // must default, never fail the whole status.
  it('defaults panes to both when an older app omits it', () => {
    expect(parseControlStatus({ ...good, panes: undefined })?.panes).toBe('both')
  })
  // The same skew, one release later. An app that predates tabs has exactly
  // one session: it is the tab at index 0 and has no id to name. A status
  // without the fields must parse to that, not to null — a null here would
  // take out `obsrv_drive` and live `obsrv_snap` wholesale against every
  // installed app older than this feature.
  it('defaults the tab when an older app omits both fields', () => {
    const { tabId: _id, tabIndex: _i, ...older } = good
    expect(parseControlStatus(older)).toEqual({ ...older, tabId: '', tabIndex: 0 })
  })
  it('defaults each tab field independently', () => {
    expect(parseControlStatus({ ...good, tabId: undefined })).toMatchObject({ tabId: '', tabIndex: 2 })
    expect(parseControlStatus({ ...good, tabIndex: undefined })).toMatchObject({ tabId: 'tab-3', tabIndex: 0 })
  })
  it('reads the orientation when present', () => {
    expect(parseControlStatus({ ...good, orientation: 'landscape' })?.orientation).toBe('landscape')
  })
  // The same skew a third time. An app older than rotation shows every screen
  // unrotated, which is what portrait means, so the default describes it
  // truthfully rather than papering over it.
  // The skew rule again: an app that predates the viewer simulation is not
  // simulating anything, and `none` says so exactly. Returning null instead
  // would take drive and live snap out against every older DMG.
  it('defaults the vision simulation to none when an older app omits it', () => {
    const { visionType: _t, visionSeverity: _s, ...older } = good
    expect(parseControlStatus(older)).toEqual({ ...older, visionType: 'none', visionSeverity: 1 })
  })

  it('reads the vision simulation when present, and refuses a bad one', () => {
    expect(parseControlStatus({ ...good, visionType: 'deutan', visionSeverity: 0.4 })).toMatchObject({
      visionType: 'deutan',
      visionSeverity: 0.4,
    })
    expect(parseControlStatus({ ...good, visionType: 'quadran' })).toBeNull()
    expect(parseControlStatus({ ...good, visionSeverity: 1.5 })).toBeNull()
    expect(parseControlStatus({ ...good, visionSeverity: 'lots' })).toBeNull()
  })

  it('defaults the orientation to portrait when an older app omits it', () => {
    const { orientation: _o, ...older } = good
    expect(parseControlStatus(older)).toEqual({ ...older, orientation: 'portrait' })
    expect(parseControlStatus({ ...good, orientation: undefined })?.orientation).toBe('portrait')
  })
  // The divergence the field exists for: `orientation` is the rotation flag
  // and `screenShape` is what that flag produced. They agree for every mobile
  // preset and part company for a landscape-natural monitor one.
  it('carries a screenShape that disagrees with the flag, and does not "fix" it', () => {
    const fresh = { ...good, presetId: '1080p-24', orientation: 'portrait', screenShape: 'landscape', cssWidth: 1920, cssHeight: 1080 }
    expect(parseControlStatus(fresh)).toMatchObject({ orientation: 'portrait', screenShape: 'landscape' })
    const rotated = { ...good, presetId: '1080p-24', orientation: 'landscape', screenShape: 'portrait', cssWidth: 1080, cssHeight: 1920 }
    expect(parseControlStatus(rotated)).toMatchObject({ orientation: 'landscape', screenShape: 'portrait' })
  })

  it('derives the shape from the dimensions when the app sent none', () => {
    const { screenShape: _s, ...noShape } = good
    expect(parseControlStatus({ ...noShape, cssWidth: 852, cssHeight: 393 })?.screenShape).toBe('landscape')
    expect(parseControlStatus({ ...noShape, cssWidth: 393, cssHeight: 852 })?.screenShape).toBe('portrait')
  })

  // An app older than rotation sends neither the shape nor the dimensions —
  // but it is showing the preset unrotated, so the preset's own natural shape
  // is exact rather than a guess. This is the case that would otherwise hand
  // an agent "portrait" for a 1920x1080 landscape monitor.
  it('falls back to the preset table for an app that sends neither', () => {
    const { screenShape: _s, cssWidth: _w, cssHeight: _h, orientation: _o, ...older } = good
    expect(parseControlStatus({ ...older, presetId: '1080p-24' })).toMatchObject({
      orientation: 'portrait',
      screenShape: 'landscape',
      cssWidth: 0,
      cssHeight: 0,
    })
    expect(parseControlStatus({ ...older, presetId: 'iphone-61' })?.screenShape).toBe('portrait')
    // A custom screen on such an app has no table row; the flag is all there is.
    expect(parseControlStatus({ ...older, presetId: 'custom' })?.screenShape).toBe('portrait')
  })

  it('defaults the dimensions to 0 — "did not say", never an invented size', () => {
    const { cssWidth: _w, cssHeight: _h, ...older } = good
    expect(parseControlStatus(older)).toMatchObject({ cssWidth: 0, cssHeight: 0 })
  })

  it.each([
    ['null', null],
    ['missing url', { ...good, url: undefined }],
    ['malformed screenShape', { ...good, screenShape: 'sideways' }],
    ['string cssWidth', { ...good, cssWidth: '852' }],
    ['negative cssHeight', { ...good, cssHeight: -1 }],
    ['NaN cssWidth', { ...good, cssWidth: Number.NaN }],
    ['bad viewMode', { ...good, viewMode: 'fill' }],
    ['malformed orientation', { ...good, orientation: 'sideways' }],
    ['numeric orientation', { ...good, orientation: 90 }],
    ['bad mode', { ...good, mode: 'video' }],
    ['numeric version', { ...good, version: 3 }],
    ['malformed panes', { ...good, panes: 'native' }],
    // Absent defaults; present-but-wrong is a malformed status, exactly as
    // for `panes`. A server that guessed past a garbled field would report a
    // tab the app never named.
    ['numeric tabId', { ...good, tabId: 3 }],
    ['string tabIndex', { ...good, tabIndex: '2' }],
    ['fractional tabIndex', { ...good, tabIndex: 1.5 }],
    ['negative tabIndex', { ...good, tabIndex: -1 }],
    ['NaN tabIndex', { ...good, tabIndex: Number.NaN }],
  ])('rejects %s', (_name, raw) => {
    expect(parseControlStatus(raw)).toBeNull()
  })
})

describe('parseControlStatus textScale', () => {
  const base = {
    version: '0.21.0',
    url: 'https://a.test/',
    presetId: 'laptop-768',
    profileId: 'reference',
    viewMode: '1:1',
    mode: 'url',
    panes: 'both',
    orientation: 'portrait',
    cssWidth: 1366,
    cssHeight: 768,
    tabId: 'tab-1',
    tabIndex: 0,
    visionType: 'none',
    visionSeverity: 1,
  }
  it('an app older than text scale reports ×1, which is what it renders', () => {
    expect(parseControlStatus(base)?.textScale).toBe(1)
  })
  it('carries a scale the app reports', () => {
    expect(parseControlStatus({ ...base, textScale: 1.5 })?.textScale).toBe(1.5)
  })
  it('a present-but-wrong scale is a malformed status', () => {
    // `null` reads as absent, like every other defaulted field of a status.
    for (const bad of ['1.5', 0, 0.25, 5, Number.NaN]) {
      expect(parseControlStatus({ ...base, textScale: bad })).toBeNull()
    }
  })
})

describe('textScaleApplyError', () => {
  it('accepts the range the app renders', () => {
    for (const ok of [0.5, 1, 1.25, 1.5, 2, 4]) expect(textScaleApplyError(ok)).toBeNull()
  })
  it('names the range for anything else', () => {
    for (const bad of [undefined, '1.5', 0.4, 4.5, Number.NaN, Number.POSITIVE_INFINITY, null]) {
      expect(textScaleApplyError(bad)).toMatch(/setTextScale payload must be \{ textScale: number \} with 0.5 <= textScale <= 4/)
    }
  })
})
