import { describe, it, expect } from 'vitest'
import {
  MAX_INLINE_IMAGE_BYTES,
  PANE_CAPTURE_HEADLESS_NOTE,
  UsageError,
  buildAuditArgs,
  buildDiffArgs,
  buildInspectArgs,
  buildReportArgs,
  inspectWhereError,
  buildSnapArgs,
  extractTrailingJson,
  killBudgetMs,
  listCatalog,
  cannotLaunchReason,
  planLive,
  planSnapPath,
  shouldInlineImage,
  stderrTail,
  urlSchemeError,
} from '../../src/mcp/lib'

const URL = 'https://x.test'
const OUT = '/tmp/mcp/snap.png'
const DIR = '/tmp/mcp/diff'

describe('buildSnapArgs', () => {
  it('fullPage bands by default; singleSurface opts out and tiled is a kept no-op', () => {
    expect(buildSnapArgs({ url: URL, fullPage: true }, OUT)).toEqual(['snap', URL, '--full-page', '--out', OUT])
    // Accepted, and adds nothing: banding is what fullPage does now.
    expect(buildSnapArgs({ url: URL, fullPage: true, tiled: true }, OUT)).toEqual(['snap', URL, '--full-page', '--out', OUT])
    expect(buildSnapArgs({ url: URL, fullPage: true, singleSurface: true }, OUT)).toEqual([
      'snap', URL, '--full-page', '--single-surface', '--out', OUT,
    ])
    expect(() => buildSnapArgs({ url: URL, tiled: true }, OUT)).toThrow(/goes with `fullPage`/)
    expect(() => buildSnapArgs({ url: URL, singleSurface: true }, OUT)).toThrow(/goes with `fullPage`/)
  })
  it('minimal input maps to snap + url + --out (CLI defaults do the rest)', () => {
    expect(buildSnapArgs({ url: URL }, OUT)).toEqual(['snap', URL, '--out', OUT])
  })
  it('preset maps to --preset', () => {
    expect(buildSnapArgs({ url: URL, preset: 'laptop-768' }, OUT)).toEqual(['snap', URL, '--preset', 'laptop-768', '--out', OUT])
  })
  it('custom dims map to --width/--height with optional --dsf/--diagonal', () => {
    expect(buildSnapArgs({ url: URL, width: 1200, height: 700 }, OUT)).toEqual([
      'snap', URL, '--width', '1200', '--height', '700', '--out', OUT,
    ])
    expect(
      buildSnapArgs({ url: URL, width: 1200, height: 700, deviceScaleFactor: 1.5, diagonalInches: 13.3 }, OUT),
    ).toEqual(['snap', URL, '--width', '1200', '--height', '700', '--dsf', '1.5', '--diagonal', '13.3', '--out', OUT])
  })
  it('profile / fullPage / waitMs / timeoutMs map to their flags', () => {
    expect(
      buildSnapArgs({ url: URL, preset: 'android-65', profile: 'budget-tn', fullPage: true, waitMs: 500, timeoutMs: 60000 }, OUT),
    ).toEqual([
      'snap', URL, '--preset', 'android-65', '--profile', 'budget-tn', '--full-page', '--wait', '500', '--timeout', '60000', '--out', OUT,
    ])
  })
  it('orientation maps to --orientation, for a preset and for custom dims alike', () => {
    expect(buildSnapArgs({ url: URL, preset: 'iphone-61', orientation: 'landscape' }, OUT)).toEqual([
      'snap', URL, '--preset', 'iphone-61', '--orientation', 'landscape', '--out', OUT,
    ])
    expect(buildSnapArgs({ url: URL, width: 900, height: 600, orientation: 'portrait' }, OUT)).toEqual([
      'snap', URL, '--orientation', 'portrait', '--width', '900', '--height', '600', '--out', OUT,
    ])
  })
  it('omits --orientation entirely when the caller did not ask, so the CLI default stands', () => {
    expect(buildSnapArgs({ url: URL, preset: 'iphone-61' }, OUT)).not.toContain('--orientation')
  })
  it('waitMs 0 is passed through, not dropped as falsy', () => {
    expect(buildSnapArgs({ url: URL, waitMs: 0 }, OUT)).toEqual(['snap', URL, '--wait', '0', '--out', OUT])
  })
  it('preset XOR custom dims: both together is a usage error naming the fix', () => {
    expect(() => buildSnapArgs({ url: URL, preset: 'laptop-768', width: 1200, height: 700 }, OUT)).toThrow(UsageError)
    expect(() => buildSnapArgs({ url: URL, preset: 'laptop-768', width: 1200, height: 700 }, OUT)).toThrow(/mutually exclusive/)
  })
  it('partial custom dims are a usage error asking for both width and height', () => {
    expect(() => buildSnapArgs({ url: URL, width: 1200 }, OUT)).toThrow(/both `width` and `height`/)
    expect(() => buildSnapArgs({ url: URL, height: 700 }, OUT)).toThrow(/both `width` and `height`/)
    expect(() => buildSnapArgs({ url: URL, deviceScaleFactor: 2 }, OUT)).toThrow(/both `width` and `height`/)
    expect(() => buildSnapArgs({ url: URL, diagonalInches: 13.3 }, OUT)).toThrow(/both `width` and `height`/)
  })
})

describe('buildDiffArgs', () => {
  it('always writes target/reference PNGs via --out-dir', () => {
    expect(buildDiffArgs({ url: URL }, DIR)).toEqual(['diff', URL, '--out-dir', DIR])
  })
  it('preset and profile map to their flags', () => {
    expect(buildDiffArgs({ url: URL, preset: 'laptop-768', profile: 'old-laptop' }, DIR)).toEqual([
      'diff', URL, '--preset', 'laptop-768', '--profile', 'old-laptop', '--out-dir', DIR,
    ])
  })
  it('waitMs / timeoutMs pass through to --wait / --timeout', () => {
    expect(buildDiffArgs({ url: URL, waitMs: 500, timeoutMs: 60000 }, DIR)).toEqual([
      'diff', URL, '--wait', '500', '--timeout', '60000', '--out-dir', DIR,
    ])
  })
})

describe('urlSchemeError', () => {
  it('accepts http, https and file URLs, case-insensitively and trimmed', () => {
    for (const url of [
      'https://x.test/page',
      'http://localhost:5173',
      'file:///tmp/fixture.html',
      'HTTPS://X.TEST',
      '  https://x.test  ',
    ]) {
      expect(urlSchemeError(url)).toBeNull()
    }
  })
  it('accepts scheme-relative and bare-host forms (they normalise downstream)', () => {
    for (const url of ['//x.test/page', 'localhost:5173', 'localhost:5173/app', 'example.com/page']) {
      expect(urlSchemeError(url)).toBeNull()
    }
  })
  it('rejects other schemes with a message naming the allowed ones', () => {
    for (const url of ['javascript:alert(1)', 'data:text/html,hi', 'chrome://settings', 'about:blank', 'ftp://x.test']) {
      const err = urlSchemeError(url)
      expect(err).toMatch(/http/)
      expect(err).toMatch(/file:/)
    }
    expect(urlSchemeError('javascript:alert(1)')).toContain('javascript:')
  })
})

describe('extractTrailingJson', () => {
  it('parses clean CLI stdout', () => {
    expect(extractTrailingJson('{\n  "settled": true\n}\n')).toEqual({ settled: true })
  })
  it('skips stray Chromium noise ahead of the JSON', () => {
    const noisy = '[1234:0821] Fontconfig warning: {weird}\nanother line\n{\n  "preset": "laptop-768"\n}\n'
    expect(extractTrailingJson(noisy)).toEqual({ preset: 'laptop-768' })
  })
  it('returns null for output with no JSON object', () => {
    expect(extractTrailingJson('no json here')).toBeNull()
    expect(extractTrailingJson('')).toBeNull()
    expect(extractTrailingJson('[1, 2, 3]')).toBeNull()
  })
})

describe('shouldInlineImage', () => {
  it('inlines up to the cap, not past it', () => {
    expect(MAX_INLINE_IMAGE_BYTES).toBe(1_572_864) // 1.5 MiB
    expect(shouldInlineImage(0)).toBe(true)
    expect(shouldInlineImage(MAX_INLINE_IMAGE_BYTES)).toBe(true)
    expect(shouldInlineImage(MAX_INLINE_IMAGE_BYTES + 1)).toBe(false)
  })
})

describe('killBudgetMs', () => {
  it('is the per-render budget times renders plus Electron boot headroom', () => {
    expect(killBudgetMs(1, 30_000)).toBe(90_000)
    expect(killBudgetMs(2, 30_000)).toBe(120_000)
  })
  it('counts waitMs into every render, so a healthy long --wait is never killed', () => {
    expect(killBudgetMs(1, 30_000, 90_000)).toBe(180_000)
    expect(killBudgetMs(2, 30_000, 90_000)).toBe(300_000)
  })
})

describe('stderrTail', () => {
  it('passes short output through trimmed', () => {
    expect(stderrTail('obsrv: unknown preset: nope\n')).toBe('obsrv: unknown preset: nope')
  })
  it('keeps only the tail of long output, marked as elided', () => {
    const long = `${'x'.repeat(5000)}THE END`
    const tail = stderrTail(long)
    expect(tail.length).toBeLessThanOrEqual(2001)
    expect(tail.startsWith('…')).toBe(true)
    expect(tail.endsWith('THE END')).toBe(true)
  })
})

const DESKTOP = { HOME: '/Users/x' } as NodeJS.ProcessEnv

describe('cannotLaunchReason', () => {
  it('names the condition, or null when a launch could put a window on screen', () => {
    expect(cannotLaunchReason(DESKTOP, 'darwin')).toBeNull()
    expect(cannotLaunchReason({ ...DESKTOP, SSH_CONNECTION: '1.2.3.4 22' }, 'darwin')).toMatch(/SSH/)
    expect(cannotLaunchReason({ ...DESKTOP, OBSRV_TEST: '1' }, 'darwin')).toMatch(/OBSRV_TEST/)
    expect(cannotLaunchReason({ ...DESKTOP }, 'linux')).toMatch(/DISPLAY/)
    expect(cannotLaunchReason({ ...DESKTOP, DISPLAY: ':0' }, 'linux')).toBeNull()
    expect(cannotLaunchReason({ ...DESKTOP, WAYLAND_DISPLAY: 'wayland-0' }, 'linux')).toBeNull()
  })
})

describe('planLive', () => {
  it('the caller asked: headless, requested', () => {
    expect(planLive('headless', [], [], DESKTOP, 'darwin')).toEqual({ path: 'headless', why: 'requested', notes: [] })
  })
  it('a headless-only operation wins over everything but a request', () => {
    expect(planLive('auto', ['fullPage is headless-only'], ['x'], DESKTOP, 'darwin')).toEqual({
      path: 'headless',
      why: 'headless-only',
      notes: ['fullPage is headless-only'],
    })
    // Even under mode: live — the operation cannot be done live at all.
    expect(planLive('live', ['fullPage is headless-only'], [], DESKTOP, 'darwin')).toMatchObject({ path: 'headless', why: 'headless-only' })
  })
  it('OBSRV_HEADLESS=1 wins before discovery, named no-display', () => {
    const p = planLive('auto', [], [], { ...DESKTOP, OBSRV_HEADLESS: '1' }, 'darwin')
    expect(p).toMatchObject({ path: 'headless', why: 'no-display' })
    expect(p.notes.join(' ')).toMatch(/OBSRV_HEADLESS/)
  })
  it('an SSH session, a missing DISPLAY, or OBSRV_TEST do not refuse an already-reachable app', () => {
    // These describe whether a launch could put a window on screen, not whether an
    // already-open, already-reachable app can be driven — so planLive stays live.
    // (Critical fix: previously these were checked here and forced headless too early.)
    expect(planLive('auto', [], [], { ...DESKTOP, SSH_CONNECTION: '1.2.3.4 22' }, 'darwin')).toEqual({ path: 'live', notes: [] })
    expect(planLive('auto', [], [], { ...DESKTOP, OBSRV_TEST: '1' }, 'darwin')).toEqual({ path: 'live', notes: [] })
    expect(planLive('auto', [], [], DESKTOP, 'linux')).toEqual({ path: 'live', notes: [] })
    // Even under an explicit mode: "live" request, none of these are refused.
    expect(planLive('live', [], [], { ...DESKTOP, SSH_CONNECTION: '1.2.3.4 22' }, 'darwin')).toEqual({ path: 'live', notes: [] })
  })
  it('otherwise live, carrying the live-only notes', () => {
    expect(planLive('auto', [], ['waitMs is ignored in live mode'], DESKTOP, 'darwin')).toEqual({ path: 'live', notes: ['waitMs is ignored in live mode'] })
  })
})

describe('planSnapPath', () => {
  it('custom dims and fullPage are headless-only, with the reason named', () => {
    expect(planSnapPath({ fullPage: true }, 'auto', DESKTOP, 'darwin')).toMatchObject({ path: 'headless', why: 'headless-only' })
    expect(planSnapPath({ width: 800, height: 600 }, 'auto', DESKTOP, 'darwin')).toMatchObject({ path: 'headless', why: 'headless-only' })
  })
  it('a plain preset snap is live, and waitMs is noted as ignored', () => {
    expect(planSnapPath({ waitMs: 500 }, 'auto', DESKTOP, 'darwin')).toEqual({ path: 'live', notes: ['waitMs is headless-only and was ignored in live mode.'] })
  })
  it('capture: pane on a headless path is noted', () => {
    const p = planSnapPath({ capture: 'pane' }, 'headless', DESKTOP, 'darwin')
    expect(p).toMatchObject({ path: 'headless', why: 'requested' })
    expect(p.notes).toContain(PANE_CAPTURE_HEADLESS_NOTE)
  })
})

describe('listCatalog', () => {
  const catalog = listCatalog()
  it('lists every screen preset with css dims, dsf, diagonal and derived ppi', () => {
    expect(catalog.presets).toHaveLength(26)
    expect(catalog.presets.find(p => p.id === 'laptop-768')).toEqual({
      id: 'laptop-768',
      label: '1366×768 15.6"',
      group: 'laptop',
      cssWidth: 1366,
      cssHeight: 768,
      deviceScaleFactor: 1,
      diagonalInches: 15.6,
      ppi: 100,
    })
    // ppi derives from *device* pixels: 393×852 @3x on 6.1" is a 461-ppi panel.
    expect(catalog.presets.find(p => p.id === 'iphone-61')?.ppi).toBe(461)
  })
  it('documents that the dimensions are natural and every preset rotates', () => {
    expect(catalog.orientation).toContain('natural orientation')
    expect(catalog.orientation).toContain('landscape')
    // The invariant an agent most needs stated, since it is what makes a
    // rotated render comparable to its unrotated self.
    expect(catalog.orientation).toContain('orientation-independent')
  })
  it('lists every panel profile with raw params and a human summary', () => {
    expect(catalog.profiles).toHaveLength(4)
    const tn = catalog.profiles.find(p => p.id === 'budget-tn')
    expect(tn).toMatchObject({ label: 'Budget TN', contrastRatio: 700, gamutCoverage: 0.72, bits: 6, frc: true, nits: 250 })
    expect(tn?.summary).toContain('700:1')
    expect(tn?.summary).toContain('72% sRGB')
    expect(tn?.summary).toContain('6-bit+FRC')
    expect(catalog.profiles.find(p => p.id === 'reference')?.summary).toMatch(/pass-through/)
  })
})

describe('buildAuditArgs', () => {
  it('maps the preset, orientation, thresholds and budgets to their flags', () => {
    expect(buildAuditArgs({ url: URL })).toEqual(['audit', URL])
    expect(
      buildAuditArgs({ url: URL, preset: 'android-65', orientation: 'landscape', tapMm: 9, textMm: 1.5, waitMs: 250, timeoutMs: 5000 }),
    ).toEqual(['audit', URL, '--preset', 'android-65', '--orientation', 'landscape', '--tap-mm', '9', '--text-mm', '1.5', '--wait', '250', '--timeout', '5000'])
  })
  it('custom dimensions map to --width/--height with the optional --dsf and --diagonal', () => {
    expect(buildAuditArgs({ url: URL, width: 1280, height: 720, deviceScaleFactor: 2, diagonalInches: 14 })).toEqual([
      'audit', URL, '--width', '1280', '--height', '720', '--dsf', '2', '--diagonal', '14',
    ])
  })
  it('refuses preset with custom dims, and custom dims without both sides', () => {
    expect(() => buildAuditArgs({ url: URL, preset: 'laptop-768', width: 100 })).toThrow(UsageError)
    expect(() => buildAuditArgs({ url: URL, width: 100 })).toThrow(UsageError)
  })
})

describe('buildReportArgs', () => {
  it('always writes the HTML via --out, and lists presets as --matrix', () => {
    expect(buildReportArgs({ url: URL }, '/tmp/r/report.html')).toEqual(['report', URL, '--out', '/tmp/r/report.html'])
    expect(
      buildReportArgs({ url: URL, presets: ['laptop-768', 'android-65'], orientation: 'landscape', profile: 'budget-tn', tapMm: 6, textMm: 1.5, waitMs: 100, timeoutMs: 9000 }, '/tmp/r/report.html'),
    ).toEqual([
      'report', URL, '--matrix', 'laptop-768,android-65', '--orientation', 'landscape', '--profile', 'budget-tn',
      '--tap-mm', '6', '--text-mm', '1.5', '--wait', '100', '--timeout', '9000', '--out', '/tmp/r/report.html',
    ])
  })
  it('refuses an empty preset list', () => {
    expect(() => buildReportArgs({ url: URL, presets: [] }, '/tmp/r/report.html')).toThrow(UsageError)
  })
})

describe('textScale maps to --text-scale', () => {
  it('on snap, after the screen and before the profile', () => {
    expect(buildSnapArgs({ url: URL, preset: 'laptop-768', textScale: 1.5, profile: 'budget-tn' }, OUT)).toEqual([
      'snap', URL, '--preset', 'laptop-768', '--text-scale', '1.5', '--profile', 'budget-tn', '--out', OUT,
    ])
  })
  it('on audit', () => {
    expect(buildAuditArgs({ url: URL, preset: 'android-65', textScale: 2 })).toEqual([
      'audit', URL, '--preset', 'android-65', '--text-scale', '2',
    ])
  })
  it('on report', () => {
    expect(buildReportArgs({ url: URL, presets: ['laptop-768'], textScale: 1.25 }, '/tmp/r.html')).toEqual([
      'report', URL, '--matrix', 'laptop-768', '--text-scale', '1.25', '--out', '/tmp/r.html',
    ])
  })
})

describe('throttle maps to --throttle on every tool', () => {
  it('snap, after the text scale', () => {
    expect(buildSnapArgs({ url: URL, preset: 'android-65', textScale: 1.5, throttle: 'budget-phone' }, OUT)).toEqual([
      'snap', URL, '--preset', 'android-65', '--text-scale', '1.5', '--throttle', 'budget-phone', '--out', OUT,
    ])
  })
  it('diff, audit and report', () => {
    expect(buildDiffArgs({ url: URL, throttle: '3g' }, DIR)).toEqual(['diff', URL, '--throttle', '3g', '--out-dir', DIR])
    expect(buildAuditArgs({ url: URL, throttle: 'cpu-4x' })).toEqual(['audit', URL, '--throttle', 'cpu-4x'])
    expect(buildReportArgs({ url: URL, throttle: 'none' }, '/tmp/r.html')).toEqual(['report', URL, '--throttle', 'none', '--out', '/tmp/r.html'])
  })
  it('the catalog lists the presets with their numbers', () => {
    const c = listCatalog()
    expect(c.throttles.map(t => t.id)).toEqual(['none', 'fast-4g', 'slow-4g', '3g', 'cpu-4x', 'cpu-6x', 'mid-phone', 'budget-phone'])
    expect(c.throttles.find(t => t.id === 'budget-phone')).toMatchObject({ cpuRate: 6, network: { latencyMs: 400 } })
    expect(c.throttles[0]).toMatchObject({ network: null, cpuRate: 1 })
  })
})

describe('buildInspectArgs', () => {
  it('a selector or a point, with the screen and panel options', () => {
    expect(buildInspectArgs({ url: URL, selector: '#grey', preset: 'laptop-768', profile: 'budget-tn' })).toEqual([
      'inspect', URL, '--selector', '#grey', '--preset', 'laptop-768', '--profile', 'budget-tn',
    ])
    expect(buildInspectArgs({ url: URL, at: { x: 20, y: 17 }, textScale: 1.5, throttle: '3g', waitMs: 100 })).toEqual([
      'inspect', URL, '--at', '20,17', '--text-scale', '1.5', '--throttle', '3g', '--wait', '100',
    ])
    expect(buildInspectArgs({ url: URL, selector: 'p', width: 800, height: 600, diagonalInches: 13.3 })).toEqual([
      'inspect', URL, '--selector', 'p', '--width', '800', '--height', '600', '--diagonal', '13.3',
    ])
  })
  it('needs a url headlessly, exactly one of at / selector, and preset xor custom dims', () => {
    expect(() => buildInspectArgs({ selector: 'p' })).toThrow(UsageError)
    expect(() => buildInspectArgs({ url: URL })).toThrow(/exactly one of `at`/)
    expect(() => buildInspectArgs({ url: URL, at: { x: 1, y: 1 }, selector: 'p' })).toThrow(/exactly one of `at`/)
    expect(() => buildInspectArgs({ url: URL, selector: 'p', preset: 'laptop-768', width: 100, height: 100 })).toThrow(/mutually exclusive/)
    expect(inspectWhereError({ selector: '   ' })).toMatch(/exactly one/)
    expect(inspectWhereError({ at: { x: 0, y: 0 } })).toBeNull()
  })
})
