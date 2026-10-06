import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * `killAndRemove.test.ts` tests the helper. Nothing tested that the two `boardServe*` hooks still CALL
 * it, so putting either `afterEach` back to "kill, then `rmSync` on the next line" left every test green
 * (Henry, reading `fix/board-serve-browser-teardown`: the fix was wired by habit). Two guards, both over
 * the real files in this directory:
 *
 *  - the shape that failed, found by its text: a file that kills a child and removes a directory
 *    recursively without `maxRetries` in the call. `process.kill(pid, 0)` (an existence probe) is not a
 *    child kill, and a recursive removal in a file that kills nothing is left alone: `electronPath` and
 *    others remove 20 directories after an `execFile` they awaited, and that is not this shape;
 *  - the two known call sites import the helper.
 *
 * What a source scan cannot see: options passed by name (`rmSync(d, OPTS)` has no `recursive` to read,
 * so it is assumed fine), and a file that kills through a wrapper. Population when this was written: no
 * file under `tests/unit` other than the helper kills a child.
 */

const DIR = __dirname

/** Block and line comments blanked, newlines kept, so line numbers stay true. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' ')).replace(/(^|\s)\/\/.*$/gm, (_m, lead: string) => lead)
}

/** The text between the call's parentheses, from the one at `open`. */
function argsFrom(code: string, open: number): string {
  let depth = 0
  for (let i = open; i < code.length; i++) {
    if (code[i] === '(') depth++
    else if (code[i] === ')' && --depth === 0) return code.slice(open, i + 1)
  }
  return code.slice(open)
}

/** 1-based lines of recursive removals with no `maxRetries`, in a source that kills a child; empty when it kills none. */
function unretriedRemovals(source: string): number[] {
  const code = stripComments(source)
  if (!/(?<!\bprocess)\.kill\(/.test(code)) return []
  const lines: number[] = []
  for (const m of code.matchAll(/\b(?:rmSync|rmdirSync|rm)\(/g)) {
    const args = argsFrom(code, m.index + m[0].length - 1)
    if (/\brecursive\b/.test(args) && !/\bmaxRetries\b/.test(args)) lines.push(code.slice(0, m.index).split('\n').length)
  }
  return lines
}

describe('unretriedRemovals: the shape that failed, and only that', () => {
  const OLD = ["afterEach(async () => {", "  for (const p of servers.splice(0)) p.kill('SIGKILL')", '  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })', '})'].join('\n')

  it('flags the old teardown: a child kill, then a recursive removal with no retries, and names the line', () => {
    expect(unretriedRemovals(OLD)).toEqual([3])
  })

  it('passes the same teardown once the removal retries, wherever the option sits in the call', () => {
    expect(unretriedRemovals(OLD.replace('force: true', 'force: true, maxRetries: 5'))).toEqual([])
    expect(unretriedRemovals(OLD.replace('{ recursive: true, force: true }', '{\n    recursive: true,\n    maxRetries: 5,\n  }'))).toEqual([])
  })

  it('flags a removal whose options span lines and carry no retries', () => {
    expect(unretriedRemovals(OLD.replace('{ recursive: true, force: true }', '{\n    recursive: true,\n    force: true,\n  }'))).toEqual([3])
  })

  it('leaves a recursive removal alone in a file that kills no child', () => {
    expect(unretriedRemovals('afterEach(() => { rmSync(d, { recursive: true, force: true }) })')).toEqual([])
  })

  it('does not take `process.kill(pid, 0)` for a child kill', () => {
    expect(unretriedRemovals('process.kill(pid, 0)\nrmSync(d, { recursive: true, force: true })')).toEqual([])
  })

  it('ignores the shape when it is only described in a comment', () => {
    const described = ["// p.kill('SIGKILL') then rmSync(d, { recursive: true, force: true })", '/* p.kill(', "   rmSync(d, { recursive: true }) */", 'const x = 1'].join('\n')
    expect(unretriedRemovals(described)).toEqual([])
  })

  it('reads a removal that is not recursive as fine', () => {
    expect(unretriedRemovals("p.kill('SIGKILL')\nrmSync(file, { force: true })")).toEqual([])
  })
})

describe('the real files under tests/unit', () => {
  const files = readdirSync(DIR).filter(f => f.endsWith('.test.ts'))
  const read = (f: string) => readFileSync(join(DIR, f), 'utf8')

  it('read the whole directory, so a clean answer below is not an empty one', () => {
    expect(files.length).toBeGreaterThan(100)
    expect(files).toContain('boardServe.test.ts')
    expect(files).toContain('boardServeBrowser.test.ts')
  })

  // This file is out of the scan: its fixtures above are the shape, as text.
  it('no other file kills a child and removes a directory recursively without maxRetries', () => {
    const offenders = files.filter(f => f !== 'teardownWiring.test.ts').flatMap(f => unretriedRemovals(read(f)).map(line => `${f}:${line}`))
    expect(offenders).toEqual([])
  })

  it('both board-serve test files take their teardown from killAndRemove, which is where a late writer is handled', () => {
    for (const f of ['boardServe.test.ts', 'boardServeBrowser.test.ts']) {
      const code = stripComments(read(f))
      expect(code, `${f} imports the helper`).toMatch(/from '\.\/killAndRemove'/)
      expect(code, `${f} calls it`).toMatch(/\bkillAndRemove\(/)
    }
  })
})
