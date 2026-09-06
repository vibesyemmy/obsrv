import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

/**
 * The launcher works the Electron binary's path out itself. `require('electron')`
 * downloads a missing binary and announces it with `console.log` — on stdout,
 * where the CLI promises nothing but machine JSON. A CI run failed exactly
 * there: `Unexpected token 'D', "Downloadin"... is not valid JSON`.
 */
const { electronBinaryPath } = createRequire(__filename)('../../bin/electronPath.js') as {
  electronBinaryPath: (pkgDir: string, override: string | undefined) => string | null
}

let dir: string
const pkg = (relative: string | null): string => {
  dir = mkdtempSync(join(tmpdir(), 'obsrv-electron-path-'))
  if (relative !== null) writeFileSync(join(dir, 'path.txt'), `${relative}\n`)
  return dir
}

describe('electronBinaryPath', () => {
  it('is dist/ plus what path.txt names, the package\'s own rule', () => {
    const d = pkg('Electron.app/Contents/MacOS/Electron')
    expect(electronBinaryPath(d, undefined)).toBe(join(d, 'dist', 'Electron.app/Contents/MacOS/Electron'))
    rmSync(d, { recursive: true, force: true })
  })
  it('an override dist path wins, and needs no path.txt', () => {
    const d = pkg('Electron.app/Contents/MacOS/Electron')
    expect(electronBinaryPath(d, '/opt/e')).toBe(join('/opt/e', 'Electron.app/Contents/MacOS/Electron'))
    rmSync(d, { recursive: true, force: true })
    const bare = pkg(null)
    expect(electronBinaryPath(bare, '/opt/e')).toBe(join('/opt/e', 'electron'))
    rmSync(bare, { recursive: true, force: true })
  })
  it('says null rather than guessing when path.txt is absent, so the caller asks the package', () => {
    const d = pkg(null)
    expect(electronBinaryPath(d, undefined)).toBeNull()
    rmSync(d, { recursive: true, force: true })
  })
  it('resolves the real installed package to a binary that exists', () => {
    const real = join(__dirname, '../../node_modules/electron')
    const p = electronBinaryPath(real, undefined)
    expect(p).toContain('electron')
    mkdirSync(join(tmpdir(), 'obsrv-noop'), { recursive: true })
  })
})
