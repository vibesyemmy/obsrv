import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

/**
 * The launcher works the Electron binary's path out itself. `require('electron')`
 * downloads a missing binary and announces it with `console.log` — on stdout,
 * where the CLI promises nothing but machine JSON. A CI run failed exactly
 * there: `Unexpected token 'D', "Downloadin"... is not valid JSON`.
 *
 * Everything here is asserted against a fixture directory, never against the
 * `electron` package actually installed: whether that package has its binary
 * yet is the machine state this code exists to cope with, so a test that reads
 * it is a test that fails on whichever machine is in the state being handled.
 */
const { electronBinaryPath } = createRequire(__filename)('../../bin/electronPath.js') as {
  electronBinaryPath: (pkgDir: string, override: string | undefined) => string | null
}

const pkg = (relative: string | null): string => {
  const dir = mkdtempSync(join(tmpdir(), 'obsrv-electron-path-'))
  if (relative !== null) writeFileSync(join(dir, 'path.txt'), `${relative}\n`)
  return dir
}

describe('electronBinaryPath', () => {
  it("is dist/ plus what path.txt names, the package's own rule", () => {
    const d = pkg('Electron.app/Contents/MacOS/Electron')
    expect(electronBinaryPath(d, undefined)).toBe(join(d, 'dist', 'Electron.app/Contents/MacOS/Electron'))
    rmSync(d, { recursive: true, force: true })
  })

  it('an override dist path wins, and needs no path.txt', () => {
    const named = pkg('Electron.app/Contents/MacOS/Electron')
    expect(electronBinaryPath(named, '/opt/e')).toBe(join('/opt/e', 'Electron.app/Contents/MacOS/Electron'))
    rmSync(named, { recursive: true, force: true })
    const bare = pkg(null)
    expect(electronBinaryPath(bare, '/opt/e')).toBe(join('/opt/e', 'electron'))
    rmSync(bare, { recursive: true, force: true })
  })

  it('says null rather than guessing when path.txt is absent, so the caller asks the package', () => {
    const d = pkg(null)
    expect(electronBinaryPath(d, undefined)).toBeNull()
    rmSync(d, { recursive: true, force: true })
  })
})
