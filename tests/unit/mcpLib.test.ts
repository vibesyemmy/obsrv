import { describe, it, expect } from 'vitest'
import {
  APP_NOT_REACHABLE,
  MAX_INLINE_IMAGE_BYTES,
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
  planSnapPath,
  shouldInlineImage,
  stderrTail,
  urlSchemeError,
} from '../../src/mcp/lib'

const URL = 'https://x.test'
const OUT = '/tmp/mcp/snap.png'
const DIR = '/tmp/mcp/diff'

describe('buildSnapArgs', () => {
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

describe('planSnapPath', () => {
  it('headless mode never probes and carries no notes', () => {
    expect(planSnapPath({}, 'headless', true)).toEqual({ path: 'headless', notes: [] })
    expect(planSnapPath({ fullPage: true }, 'headless', false)).toEqual({ path: 'headless', notes: [] })
  })
  it('auto without a reachable app is a silent headless fallback', () => {
    expect(planSnapPath({}, 'auto', false)).toEqual({ path: 'headless', notes: [] })
  })
  it('auto with a reachable app goes live', () => {
    expect(planSnapPath({}, 'auto', true)).toEqual({ path: 'live', notes: [] })
  })
  it('live without a reachable app is an actionable error, never a fallback', () => {
    const r = planSnapPath({}, 'live', false)
    expect(r).toHaveProperty('error')
    expect((r as { error: string }).error).toBe(APP_NOT_REACHABLE)
    expect(APP_NOT_REACHABLE).toMatch(/Agent control/)
  })
  it('custom dims fall back to headless with a note, even under explicit live', () => {
    for (const input of [{ width: 800, height: 600 }, { deviceScaleFactor: 2 }, { diagonalInches: 14 }]) {
      for (const mode of ['auto', 'live'] as const) {
        const r = planSnapPath(input, mode, true)
        expect(r).toMatchObject({ path: 'headless' })
        expect((r as { notes: string[] }).notes.join(' ')).toMatch(/custom dimensions/)
      }
    }
  })
  it('fullPage falls back to headless with a note', () => {
    const r = planSnapPath({ fullPage: true }, 'auto', true)
    expect(r).toMatchObject({ path: 'headless' })
    expect((r as { notes: string[] }).notes.join(' ')).toMatch(/fullPage/)
  })
  it('waitMs stays live but is noted as ignored', () => {
    const r = planSnapPath({ waitMs: 500 }, 'auto', true)
    expect(r).toMatchObject({ path: 'live' })
    expect((r as { notes: string[] }).notes.join(' ')).toMatch(/waitMs/)
  })
  it("capture: 'pane' rides the live path silently", () => {
    expect(planSnapPath({ capture: 'pane' }, 'auto', true)).toEqual({ path: 'live', notes: [] })
  })
  it("capture: 'pane' is noted as ignored on every headless path", () => {
    for (const r of [
      planSnapPath({ capture: 'pane' }, 'headless', true),
      planSnapPath({ capture: 'pane' }, 'auto', false),
      planSnapPath({ capture: 'pane', fullPage: true }, 'auto', true),
    ]) {
      expect(r).toMatchObject({ path: 'headless' })
      expect((r as { notes: string[] }).notes.join(' ')).toMatch(/capture/)
    }
  })
  it("capture: 'window' adds no note anywhere", () => {
    expect(planSnapPath({ capture: 'window' }, 'headless', false)).toEqual({ path: 'headless', notes: [] })
    expect(planSnapPath({ capture: 'window' }, 'auto', true)).toEqual({ path: 'live', notes: [] })
  })
})

describe('listCatalog', () => {
  const catalog = listCatalog()
  it('lists every screen preset with css dims, dsf, diagonal and derived ppi', () => {
    expect(catalog.presets).toHaveLength(22)
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
