import { describe, it, expect } from 'vitest'
import { ArgError, parseArgs, type DiffCommand, type SnapCommand } from '../../src/cli/args'

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
      { presetId: '1080p-24', cssWidth: 1920, cssHeight: 1080, deviceScaleFactor: 1, diagonalInches: 24 },
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
    expect(cmd.specs[0]).toEqual({ presetId: 'iphone-61', cssWidth: 393, cssHeight: 852, deviceScaleFactor: 3, diagonalInches: 6.1 })
    expect(cmd.out).toBe('obsrv-iphone-61.png')
  })
  it('rejects an unknown preset, listing the valid ids', () => {
    expect(() => snap('x.test', '--preset', 'vga')).toThrow(/unknown preset: vga/)
    expect(() => snap('x.test', '--preset', 'vga')).toThrow(/laptop-768/)
  })
  it('accepts custom --width/--height with optional --dsf and --diagonal', () => {
    const cmd = snap('x.test', '--width', '800', '--height', '600', '--dsf', '2', '--diagonal', '13.3')
    expect(cmd.specs[0]).toEqual({ presetId: 'custom', cssWidth: 800, cssHeight: 600, deviceScaleFactor: 2, diagonalInches: 13.3 })
    expect(cmd.out).toBe('obsrv-custom.png')
  })
  it('custom dims default dsf 1 and no diagonal', () => {
    const cmd = snap('x.test', '--width', '640', '--height', '480')
    expect(cmd.specs[0]).toEqual({ presetId: 'custom', cssWidth: 640, cssHeight: 480, deviceScaleFactor: 1, diagonalInches: null })
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
