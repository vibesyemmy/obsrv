import { describe, it, expect } from 'vitest'
import { DEFAULT_THIN_PX } from '../../src/cli/lint'
import type { LintCommand } from '../../src/cli/args'
import { ArgError, DEFAULT_REPORT_MATRIX, DEFAULT_REPORT_OUT, DEFAULT_TAP_MM, DEFAULT_TEXT_MM, parseArgs, type AuditCommand, type DiffCommand, type ReportCommand, type SnapCommand } from '../../src/cli/args'

const snap = (...args: string[]): SnapCommand => parseArgs(['snap', ...args]) as SnapCommand
const diff = (...args: string[]): DiffCommand => parseArgs(['diff', ...args]) as DiffCommand

describe('parseArgs: commands', () => {
  it('no args / help / --help return usage', () => {
    for (const argv of [[], ['help'], ['--help'], ['-h']]) {
      const cmd = parseArgs(argv)
      expect(cmd.command).toBe('help')
      if (cmd.command === 'help') expect(cmd.text).toContain('obsrv snap <url>')
    }
  })
  it('rejects unknown commands', () => {
    expect(() => parseArgs(['grab', 'https://x.test'])).toThrow(ArgError)
    expect(() => parseArgs(['grab'])).toThrow(/unknown command: grab/)
  })
  it('requires a url', () => {
    expect(() => parseArgs(['snap'])).toThrow(/usage/i)
    expect(() => parseArgs(['diff', '--preset', 'laptop-768'])).toThrow(/usage/i)
  })
  it('rejects a second positional argument', () => {
    expect(() => snap('https://a.test', 'https://b.test')).toThrow(/unexpected argument/)
  })
})

describe('parseArgs: snap', () => {
  it('defaults: 1080p-24, reference profile, derived out name', () => {
    const cmd = snap('https://x.test')
    expect(cmd.url).toBe('https://x.test')
    expect(cmd.specs).toEqual([
      { presetId: '1080p-24', cssWidth: 1920, cssHeight: 1080, deviceScaleFactor: 1, diagonalInches: 24, orientation: 'portrait', mobile: false, textScale: 1, throttle: null },
    ])
    expect(cmd.profileId).toBe('reference')
    expect(cmd.out).toBe('obsrv-1080p-24.png')
    expect(cmd.matrix).toBe(false)
    expect(cmd.fullPage).toBe(false)
    expect(cmd.waitMs).toBe(0)
    expect(cmd.timeoutMs).toBe(30_000)
  })
  it('resolves a preset, including mobile dsf', () => {
    const cmd = snap('x.test', '--preset', 'iphone-61')
    expect(cmd.specs[0]).toEqual({ presetId: 'iphone-61', cssWidth: 393, cssHeight: 852, deviceScaleFactor: 3, diagonalInches: 6.1, orientation: 'portrait', mobile: true, textScale: 1, throttle: null })
    expect(cmd.out).toBe('obsrv-iphone-61.png')
  })
  it('rejects an unknown preset, listing the valid ids', () => {
    expect(() => snap('x.test', '--preset', 'vga')).toThrow(/unknown preset: vga/)
    expect(() => snap('x.test', '--preset', 'vga')).toThrow(/laptop-768/)
  })
  it('accepts custom --width/--height with optional --dsf and --diagonal', () => {
    const cmd = snap('x.test', '--width', '800', '--height', '600', '--dsf', '2', '--diagonal', '13.3')
    expect(cmd.specs[0]).toEqual({ presetId: 'custom', cssWidth: 800, cssHeight: 600, deviceScaleFactor: 2, diagonalInches: 13.3, orientation: 'portrait', mobile: false, textScale: 1, throttle: null })
    expect(cmd.out).toBe('obsrv-custom.png')
  })
  it('custom dims default dsf 1 and no diagonal', () => {
    const cmd = snap('x.test', '--width', '640', '--height', '480')
    expect(cmd.specs[0]).toEqual({ presetId: 'custom', cssWidth: 640, cssHeight: 480, deviceScaleFactor: 1, diagonalInches: null, orientation: 'portrait', mobile: false, textScale: 1, throttle: null })
  })
  it('rejects --preset combined with custom dims', () => {
    expect(() => snap('x.test', '--preset', 'laptop-768', '--width', '800', '--height', '600')).toThrow(/mutually exclusive/)
  })
  it('rejects --width without --height, and dsf/diagonal without both', () => {
    expect(() => snap('x.test', '--width', '800')).toThrow(/--width and --height/)
    expect(() => snap('x.test', '--dsf', '2')).toThrow(/--width and --height/)
  })
  it('rejects dims whose device pixels exceed 4096', () => {
    expect(() => snap('x.test', '--width', '3000', '--height', '600', '--dsf', '2')).toThrow(/4096/)
    expect(() => snap('x.test', '--width', '5000', '--height', '600')).toThrow(/4096/)
  })
  it('rejects malformed numbers', () => {
    expect(() => snap('x.test', '--width', 'abc', '--height', '600')).toThrow(ArgError)
    expect(() => snap('x.test', '--wait', '-5')).toThrow(ArgError)
    expect(() => snap('x.test', '--width', '0', '--height', '600')).toThrow(ArgError)
    expect(() => snap('x.test', '--width', '99.5', '--height', '600')).toThrow(/integer/)
  })
  it('parses --matrix into one spec per preset', () => {
    const cmd = snap('x.test', '--matrix', 'laptop-768,android-65,1080p-24')
    expect(cmd.matrix).toBe(true)
    expect(cmd.specs.map(s => s.presetId)).toEqual(['laptop-768', 'android-65', '1080p-24'])
    expect(cmd.out).toBe('.')
  })
  it('rejects --matrix with --preset or custom dims, and unknown matrix ids', () => {
    expect(() => snap('x.test', '--matrix', 'laptop-768', '--preset', '1080p-24')).toThrow(/--matrix/)
    expect(() => snap('x.test', '--matrix', 'laptop-768', '--width', '800', '--height', '600')).toThrow(/--matrix/)
    expect(() => snap('x.test', '--matrix', 'laptop-768,nope')).toThrow(/unknown preset: nope/)
  })
  it('accepts --profile and rejects unknown profiles', () => {
    expect(snap('x.test', '--profile', 'budget-tn').profileId).toBe('budget-tn')
    expect(() => snap('x.test', '--profile', 'oled')).toThrow(/unknown profile: oled/)
  })
  it('accepts --full-page, --wait, --timeout, --out', () => {
    const cmd = snap('x.test', '--full-page', '--wait', '250', '--timeout', '5000', '--out', 'shots/red.png')
    expect(cmd.fullPage).toBe(true)
    expect(cmd.waitMs).toBe(250)
    expect(cmd.timeoutMs).toBe(5000)
    expect(cmd.out).toBe('shots/red.png')
  })
  it('rejects diff-only flags', () => {
    expect(() => snap('x.test', '--out-dir', 'd')).toThrow(/diff/)
    expect(() => snap('x.test', '--json')).toThrow(/diff/)
  })
  it('repeated flags: the last occurrence wins (documented in --help)', () => {
    const cmd = snap('x.test', '--preset', 'laptop-768', '--preset', '1080p-24')
    expect(cmd.specs[0]!.presetId).toBe('1080p-24')
    const help = parseArgs(['--help'])
    if (help.command === 'help') expect(help.text).toContain('last occurrence wins')
  })
  it('rejects unknown flags and flags missing their value', () => {
    expect(() => snap('x.test', '--bogus')).toThrow(/unknown flag: --bogus/)
    expect(() => snap('x.test', '--preset')).toThrow(/--preset requires a value/)
  })
})

describe('parseArgs: --orientation', () => {
  it('defaults to portrait, which is the preset exactly as stored', () => {
    expect(snap('x.test', '--preset', 'iphone-61').specs[0]).toMatchObject({ cssWidth: 393, cssHeight: 852 })
    expect(snap('x.test', '--preset', 'iphone-61', '--orientation', 'portrait').specs[0]).toMatchObject({
      cssWidth: 393,
      cssHeight: 852,
    })
  })

  it('swaps the CSS axes in landscape, leaving dsf and diagonal alone', () => {
    expect(snap('x.test', '--preset', 'iphone-61', '--orientation', 'landscape').specs[0]).toEqual({
      presetId: 'iphone-61',
      cssWidth: 852,
      cssHeight: 393,
      deviceScaleFactor: 3,
      diagonalInches: 6.1,
      orientation: 'landscape',
      mobile: true, textScale: 1, throttle: null,
    })
  })

  it('rotates every entry of a matrix', () => {
    const cmd = snap('x.test', '--matrix', 'iphone-61,android-65', '--orientation', 'landscape')
    expect(cmd.specs.map(sp => [sp.cssWidth, sp.cssHeight])).toEqual([
      [852, 393],
      [800, 360],
    ])
  })

  it('rotates custom dims too', () => {
    expect(snap('x.test', '--width', '900', '--height', '600', '--orientation', 'landscape').specs[0]).toMatchObject({
      cssWidth: 600,
      cssHeight: 900,
    })
  })

  it('applies to diff as well, and the 1x/2x bounds are checked after rotating', () => {
    expect(diff('x.test', '--preset', 'laptop-768', '--orientation', 'landscape').spec).toMatchObject({
      cssWidth: 768,
      cssHeight: 1366,
    })
    // 1600x900 fits a 2x reference either way round; 2560x1440 fits neither.
    expect(() => diff('x.test', '--preset', '1440p-27', '--orientation', 'landscape')).toThrow(/2x reference/)
  })

  it('rejects anything that is not one of the two words', () => {
    expect(() => snap('x.test', '--orientation', 'sideways')).toThrow(/--orientation/)
    expect(() => snap('x.test', '--orientation', 'sideways')).toThrow(/portrait/)
    expect(() => snap('x.test', '--orientation')).toThrow(/--orientation requires a value/)
  })

  it('carries the flag on every spec, so a matrix run can report per render', () => {
    const cmd = snap('x.test', '--matrix', 'iphone-61,1080p-24', '--orientation', 'landscape')
    expect(cmd.specs.map(sp => sp.orientation)).toEqual(['landscape', 'landscape'])
    // The measured surprise the help text now has to explain: one flag, two
    // different resulting shapes, because the two presets are stored
    // differently.
    expect(cmd.specs.map(sp => [sp.cssWidth, sp.cssHeight])).toEqual([
      [852, 393],
      [1080, 1920],
    ])
  })

  it('--help explains that the flag names the stored orientation, not the shape', () => {
    const help = parseArgs(['--help'])
    expect(help.command).toBe('help')
    const text = help.command === 'help' ? help.text : ''
    expect(text).toContain('--orientation')
    expect(text).toContain('landscape')
    // The three things a reader cannot work out from "portrait | landscape".
    expect(text).toContain('not the shape you get')
    expect(text).toContain('landscape-natural')
    expect(text).toContain('1080x1920')
  })

  it('the diff bound message names the rotation rather than blaming the preset id', () => {
    // "1440p-27 is 1440×2560" would describe a shape that id never has.
    const err = (): void => {
      diff('x.test', '--preset', '1440p-27', '--orientation', 'landscape')
    }
    expect(err).toThrow(/rotated a quarter turn/)
    expect(err).toThrow(/1440×2560/)
    // Unrotated, there is no rotation to mention.
    expect(() => diff('x.test', '--preset', '1440p-27')).toThrow(/"1440p-27" is 2560×1440/)
  })
})

describe('parseArgs: diff', () => {
  it('defaults mirror snap, without an out file', () => {
    const cmd = diff('x.test')
    expect(cmd.spec.presetId).toBe('1080p-24')
    expect(cmd.profileId).toBe('reference')
    expect(cmd.outDir).toBeNull()
    expect(cmd.waitMs).toBe(0)
    expect(cmd.timeoutMs).toBe(30_000)
  })
  it('accepts --out-dir and the (default-anyway) --json flag', () => {
    const cmd = diff('x.test', '--preset', 'laptop-768', '--out-dir', 'diffout', '--json')
    expect(cmd.spec.presetId).toBe('laptop-768')
    expect(cmd.outDir).toBe('diffout')
  })
  it('rejects dsf > 1 presets: the reference comparison is 1x-only', () => {
    expect(() => diff('x.test', '--preset', 'iphone-61')).toThrow(/1x/)
    expect(() => diff('x.test', '--width', '360', '--height', '800', '--dsf', '2')).toThrow(/1x/)
  })
  it('rejects presets too wide for a 2x reference within the 4096 device-px budget', () => {
    expect(() => diff('x.test', '--preset', '1440p-27')).toThrow(/2x reference/)
    expect(() => diff('x.test', '--width', '2100', '--height', '900')).toThrow(/2x reference/)
  })
  it('rejects snap-only flags', () => {
    expect(() => diff('x.test', '--matrix', 'laptop-768')).toThrow(/snap/)
    expect(() => diff('x.test', '--full-page')).toThrow(/snap/)
    expect(() => diff('x.test', '--out', 'a.png')).toThrow(/snap/)
  })
})

describe('parseArgs: audit', () => {
  const audit = (...args: string[]): AuditCommand => parseArgs(['audit', ...args]) as AuditCommand

  it('defaults: 1080p-24, provisional thresholds, no profile', () => {
    const cmd = audit('https://x.test')
    expect(cmd.command).toBe('audit')
    expect(cmd.spec.presetId).toBe('1080p-24')
    expect(cmd.spec.mobile).toBe(false)
    expect(cmd.tapMm).toBe(DEFAULT_TAP_MM)
    expect(cmd.textMm).toBe(DEFAULT_TEXT_MM)
    expect(cmd.waitMs).toBe(0)
  })
  it('a phone preset is mobile; thresholds are floats', () => {
    const cmd = audit('x.test', '--preset', 'android-65', '--tap-mm', '9', '--text-mm', '1.5')
    expect(cmd.spec.mobile).toBe(true)
    expect(cmd.tapMm).toBe(9)
    expect(cmd.textMm).toBe(1.5)
  })
  it('custom dimensions carry a null diagonal (no millimetres) unless --diagonal is given', () => {
    expect(audit('x.test', '--width', '1280', '--height', '720').spec.diagonalInches).toBeNull()
    expect(audit('x.test', '--width', '1280', '--height', '720', '--diagonal', '14').spec.diagonalInches).toBe(14)
  })
  it('refuses --profile, --matrix and the other commands\' flags', () => {
    expect(() => audit('x.test', '--profile', 'budget-tn')).toThrow(/does not apply/)
    expect(() => audit('x.test', '--matrix', 'laptop-768,1080p-24')).toThrow(/snap flag/)
    expect(() => audit('x.test', '--out', 'x.png')).toThrow(/snap flag/)
    expect(() => audit('x.test', '--out-dir', 'd')).toThrow(/diff flag/)
    expect(() => parseArgs(['snap', 'x.test', '--tap-mm', '5'])).toThrow(/an audit flag/)
  })
  it('rejects a negative or non-numeric threshold', () => {
    expect(() => audit('x.test', '--tap-mm', '-1')).toThrow(/tap-mm/)
    expect(() => audit('x.test', '--text-mm', 'big')).toThrow(/text-mm/)
  })
  it('the usage text names the command and its flags', () => {
    const cmd = parseArgs([])
    if (cmd.command === 'help') {
      expect(cmd.text).toContain('obsrv audit <url>')
      expect(cmd.text).toContain('--tap-mm')
    }
  })
})

describe('parseArgs: report', () => {
  const report = (...args: string[]): ReportCommand => parseArgs(['report', ...args]) as ReportCommand

  it('defaults to the four-screen matrix, the reference profile and obsrv-report.html', () => {
    const cmd = report('https://x.test')
    expect(cmd.specs.map(s => s.presetId)).toEqual([...DEFAULT_REPORT_MATRIX])
    expect(cmd.specs.map(s => s.mobile)).toEqual([false, false, true, true])
    expect(cmd.profileId).toBe('reference')
    expect(cmd.out).toBe(DEFAULT_REPORT_OUT)
    expect(cmd.tapMm).toBe(DEFAULT_TAP_MM)
    expect(cmd.textMm).toBe(DEFAULT_TEXT_MM)
  })
  it('takes --matrix, --preset or custom dims, with --out, --profile and the audit thresholds', () => {
    expect(report('x.test', '--matrix', 'laptop-768,android-65').specs.map(s => s.presetId)).toEqual(['laptop-768', 'android-65'])
    expect(report('x.test', '--preset', 'iphone-61').specs.map(s => s.presetId)).toEqual(['iphone-61'])
    expect(report('x.test', '--width', '1280', '--height', '720', '--diagonal', '14').specs[0]).toMatchObject({ presetId: 'custom', diagonalInches: 14 })
    const cmd = report('x.test', '--out', 'r/page.html', '--profile', 'budget-tn', '--tap-mm', '6', '--text-mm', '1.5')
    expect(cmd.out).toBe('r/page.html')
    expect(cmd.profileId).toBe('budget-tn')
    expect(cmd.tapMm).toBe(6)
    expect(cmd.textMm).toBe(1.5)
  })
  it('rotates the default matrix too', () => {
    expect(report('x.test', '--orientation', 'landscape').specs.map(s => [s.cssWidth, s.cssHeight])).toEqual([
      [768, 1366], [1080, 1920], [800, 360], [852, 393],
    ])
  })
  it('refuses the other commands\' flags, naming their owner', () => {
    expect(() => report('x.test', '--full-page')).toThrow(/snap flag/)
    expect(() => report('x.test', '--out-dir', 'd')).toThrow(/diff flag/)
    expect(() => parseArgs(['diff', 'x.test', '--out', 'r.html'])).toThrow(/snap flag/)
  })
})

describe('parseArgs: --throttle', () => {
  it('absent is null on every spec, so the flagless JSON stays the contract it was', () => {
    expect(snap('https://x.test').specs[0]!.throttle).toBeNull()
    expect(diff('https://x.test').spec.throttle).toBeNull()
  })
  it('a preset id lands on every spec of the run, `none` included', () => {
    expect(snap('https://x.test', '--throttle', '3g').specs[0]!.throttle).toBe('3g')
    expect(snap('https://x.test', '--throttle', 'none').specs[0]!.throttle).toBe('none')
    const m = snap('https://x.test', '--matrix', 'laptop-768,android-65', '--throttle', 'budget-phone')
    expect(m.specs.map(s => s.throttle)).toEqual(['budget-phone', 'budget-phone'])
    const r = parseArgs(['report', 'https://x.test', '--throttle', 'mid-phone']) as ReportCommand
    expect(r.specs.every(s => s.throttle === 'mid-phone')).toBe(true)
    expect((parseArgs(['audit', 'https://x.test', '--throttle', 'cpu-6x']) as AuditCommand).spec.throttle).toBe('cpu-6x')
  })
  it('an unknown id names the valid ones', () => {
    expect(() => snap('https://x.test', '--throttle', 'edge')).toThrow(/--throttle: expected one of none, fast-4g, slow-4g, 3g, cpu-4x, cpu-6x, mid-phone, budget-phone/)
  })
})

describe('parseArgs: lint', () => {
  const lint = (...args: string[]): LintCommand => parseArgs(['lint', ...args]) as LintCommand

  it('defaults: 1080p-24, the reference panel, the provisional thin threshold', () => {
    const cmd = lint('https://x.test')
    expect(cmd.command).toBe('lint')
    expect(cmd.spec.presetId).toBe('1080p-24')
    expect(cmd.profileId).toBe('reference')
    expect(cmd.thinPx).toBe(DEFAULT_THIN_PX)
    expect(cmd.waitMs).toBe(0)
  })
  it('takes a profile (the contrast-on-panel rule needs one) and the threshold', () => {
    const cmd = lint('x.test', '--preset', 'android-65', '--profile', 'budget-tn', '--thin-px', '12')
    expect(cmd.spec.mobile).toBe(true)
    expect(cmd.profileId).toBe('budget-tn')
    expect(cmd.thinPx).toBe(12)
  })
  it("refuses --matrix and the other commands' flags, naming their owner", () => {
    expect(() => lint('x.test', '--matrix', 'laptop-768,1080p-24')).toThrow(/snap flag/)
    expect(() => lint('x.test', '--tap-mm', '9')).toThrow(/audit flag/)
    expect(() => parseArgs(['audit', 'x.test', '--thin-px', '9'])).toThrow(/lint flag/)
  })
})

describe('parseArgs: inspect', () => {
  const inspect = (...args: string[]) => parseArgs(['inspect', 'https://x.test', ...args])
  it('a point, or a selector, on one screen with a panel', () => {
    const at = inspect('--at', '20,17', '--preset', 'laptop-768', '--profile', 'budget-tn')
    expect(at).toMatchObject({ command: 'inspect', url: 'https://x.test', at: { x: 20, y: 17 }, selector: null, profileId: 'budget-tn' })
    if (at.command === 'inspect') expect(at.spec.presetId).toBe('laptop-768')
    const sel = inspect('--selector', ' #grey ')
    expect(sel).toMatchObject({ at: null, selector: '#grey' })
  })
  it('exactly one of the two, and a point is x,y', () => {
    expect(() => inspect()).toThrow(/exactly one of --at <x,y> or --selector <css>/)
    expect(() => inspect('--at', '1,1', '--selector', 'p')).toThrow(/exactly one/)
    expect(() => inspect('--at', 'twenty')).toThrow(/--at: expected x,y/)
    expect(() => inspect('--at', '-1,5')).toThrow(/--at: expected x,y/)
    expect(() => inspect('--selector', '')).toThrow(/--selector/)
    expect(() => inspect('--selector', 'p', '--matrix', 'laptop-768,android-65')).toThrow(/--matrix is a snap flag/)
  })
})
