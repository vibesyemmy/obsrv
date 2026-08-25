import { describe, it, expect } from 'vitest'
import {
  MAX_INLINE_IMAGE_BYTES,
  UsageError,
  buildDiffArgs,
  buildSnapArgs,
  extractTrailingJson,
  killBudgetMs,
  listCatalog,
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

describe('listCatalog', () => {
  const catalog = listCatalog()
  it('lists every screen preset with css dims, dsf, diagonal and derived ppi', () => {
    expect(catalog.presets).toHaveLength(15)
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
