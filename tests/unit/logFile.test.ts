import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LOG_MAX_LINE, formatLine, openLogFile } from '../../src/shared/logFile'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'obsrv-log-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('formatLine', () => {
  it('is one line: ISO timestamp, padded level, message', () => {
    const at = new Date('2026-09-02T12:37:52.461Z')
    expect(formatLine('warn', 'GPU process gone (hung, exit code 512)', at)).toBe(
      '2026-09-02T12:37:52.461Z warn  GPU process gone (hung, exit code 512)\n',
    )
    expect(formatLine('info', 'x', at)).toMatch(/Z info  x\n$/)
    expect(formatLine('error', 'x', at)).toMatch(/Z error x\n$/)
  })
  it('folds newlines, so a multi-line message cannot pose as several entries', () => {
    const line = formatLine('info', 'one\n  two\r\nthree')
    expect(line.endsWith('\n')).toBe(true)
    expect(line.slice(0, -1)).not.toContain('\n')
    expect(line).toContain('one | two | three')
  })
  it('clips a runaway message', () => {
    const line = formatLine('info', 'x'.repeat(LOG_MAX_LINE * 3))
    expect(line.length).toBeLessThan(LOG_MAX_LINE + 40)
    expect(line).toContain('…')
  })
})

describe('openLogFile', () => {
  it('creates the directory and appends lines in order', () => {
    const path = join(dir, 'nested', 'deeper', 'obsrv.log')
    const log = openLogFile(path)
    log.write('info', 'first')
    log.write('warn', 'second')
    const lines = readFileSync(path, 'utf8').trimEnd().split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatch(/ info  first$/)
    expect(lines[1]).toMatch(/ warn  second$/)
  })

  it('rotates to .1 once the file is over the limit, keeping one predecessor', () => {
    const path = join(dir, 'obsrv.log')
    // Rotation follows the write that crossed the limit, so the live file
    // can be empty (or absent) at the instant after; the union with its
    // predecessor is what holds the recent lines.
    const live = (): string => (existsSync(path) ? readFileSync(path, 'utf8') : '')
    const previous = (): string => readFileSync(`${path}.1`, 'utf8')
    const log = openLogFile(path, 300)
    for (let i = 0; i < 12; i++) log.write('info', `line ${i} ${'p'.repeat(40)}`)
    expect(existsSync(`${path}.1`)).toBe(true)
    expect(live().length).toBeLessThan(300)
    expect(live() + previous()).toContain('line 11 ')
    // A second round replaces the predecessor rather than adding a .2, and
    // the oldest lines are gone: at most two files of history.
    for (let i = 12; i < 24; i++) log.write('info', `line ${i} ${'p'.repeat(40)}`)
    expect(existsSync(`${path}.2`)).toBe(false)
    expect(live() + previous()).toContain('line 23 ')
    expect(previous()).not.toContain('line 0 ')
  })

  it('rotates an oversized file it was opened on before writing to it', () => {
    const path = join(dir, 'obsrv.log')
    const big = openLogFile(path, 1 << 20)
    big.write('info', 'y'.repeat(600))
    const reopened = openLogFile(path, 100)
    reopened.write('info', 'fresh')
    expect(readFileSync(`${path}.1`, 'utf8')).toContain('yyyy')
    expect(readFileSync(path, 'utf8')).not.toContain('yyyy')
    expect(readFileSync(path, 'utf8')).toContain('fresh')
  })

  it('never throws when the file cannot be written', () => {
    // A path under a regular file: mkdir fails, and so would every append.
    const blocker = join(dir, 'blocker')
    openLogFile(blocker).write('info', 'occupy')
    const log = openLogFile(join(blocker, 'obsrv.log'))
    expect(() => log.write('warn', 'lost')).not.toThrow()
    expect(log.path).toBe(join(blocker, 'obsrv.log'))
  })
})
