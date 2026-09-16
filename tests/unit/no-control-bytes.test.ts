import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

/**
 * No text file in the tree carries a literal control byte
 * (bug-control-bytes-hide-files-from-grep). One makes `ugrep -I`, and any
 * search that skips binary files, treat the whole file as binary and return
 * nothing, which reads exactly like "the pattern is not there". Two files did,
 * both for good reasons; written as escapes (`\x00`), JavaScript reads them
 * the same and every search can see the file. Tab, line feed and carriage
 * return are text.
 */

const ROOT = resolve(__dirname, '../..')
const DIRS = ['src', 'tests', 'scripts']
// Every text format the tree holds, fixtures included: an HTML or SVG fixture with a
// control byte is just as invisible to a search as a source file.
const TEXT = /\.(ts|tsx|js|mjs|cjs|json|md|html|htm|svg|xml|css|yml|yaml|sh|txt)$/
const CONTROL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/

function textFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return textFiles(path)
    return TEXT.test(name) ? [path] : []
  })
}

describe('control bytes', () => {
  it('appear in no text file under src, tests or scripts, so every search can see every file', () => {
    const files = DIRS.flatMap(d => textFiles(join(ROOT, d)))
    // Not vacuous: the walk reaches the tree, including the two files that carried them.
    expect(files.length).toBeGreaterThan(100)
    expect(files.map(f => relative(ROOT, f))).toEqual(
      expect.arrayContaining(['src/shared/ipcPayloads.ts', 'tests/unit/ipcPayloads.test.ts']),
    )
    const found = files.flatMap(f =>
      readFileSync(f, 'latin1')
        .split('\n')
        .flatMap((line, i) => (CONTROL.test(line) ? [`${relative(ROOT, f)}:${i + 1}`] : [])),
    )
    expect(found, 'write these as escapes (\\x00) rather than literal bytes').toEqual([])
  })
})
