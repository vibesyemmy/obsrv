import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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
const { electronBinaryPath, electronStatus, ensureElectron, downloadLine } = createRequire(__filename)('../../bin/electronPath.js') as {
  electronBinaryPath: (pkgDir: string, override: string | undefined) => string | null
  electronStatus: (pkgDir: string | null, override?: string) => { present: true; path: string; pkgDir: string } | { present: false; pkgDir: string; version: string } | { present: false; error: string }
  ensureElectron: (options: { pkgDir: string; onData?: (chunk: string) => void }) => Promise<{ path: string; downloadedMs: number } | { error: string }>
  downloadLine: (version: string) => string
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

/** A stand-in for the `electron` package: a version, and an installer of our own writing. */
const stub = (installJs: string | null): string => {
  const dir = mkdtempSync(join(tmpdir(), 'obsrv-electron-stub-'))
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'electron', version: '9.9.9' }))
  if (installJs !== null) writeFileSync(join(dir, 'install.js'), installJs)
  return dir
}

describe('electronStatus', () => {
  it('is present when path.txt names a file that exists under dist/', () => {
    const d = stub(null)
    mkdirSync(join(d, 'dist'))
    writeFileSync(join(d, 'dist', 'electron-bin'), '')
    writeFileSync(join(d, 'path.txt'), 'electron-bin\n')
    expect(electronStatus(d)).toEqual({ present: true, path: join(d, 'dist', 'electron-bin'), pkgDir: d })
    rmSync(d, { recursive: true, force: true })
  })

  it("is absent, with the package's version for the sentence, when path.txt is missing — a fresh install", () => {
    const d = stub(null)
    expect(electronStatus(d)).toEqual({ present: false, pkgDir: d, version: '9.9.9' })
    rmSync(d, { recursive: true, force: true })
  })

  it('is an error when there is no electron package at all', () => {
    expect(electronStatus(null)).toMatchObject({ present: false, error: expect.stringContaining('npm install') })
  })
})

describe('ensureElectron', () => {
  it("runs the package's own installer, streams what it prints, and answers the binary once it is there", async () => {
    const d = stub(`
      const fs = require('fs'), path = require('path')
      process.stdout.write('progress 50%\\n')
      setTimeout(() => {
        fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true })
        fs.writeFileSync(path.join(__dirname, 'dist', 'electron-bin'), '')
        fs.writeFileSync(path.join(__dirname, 'path.txt'), 'electron-bin\\n')
      }, 100)
    `)
    const seen: string[] = []
    const r = await ensureElectron({ pkgDir: d, onData: c => seen.push(c) })
    expect(r).toMatchObject({ path: join(d, 'dist', 'electron-bin') })
    expect((r as { downloadedMs: number }).downloadedMs).toBeGreaterThanOrEqual(100)
    expect(seen.join('')).toContain('progress 50%')
    rmSync(d, { recursive: true, force: true })
  })

  it('answers at once, without running the installer, when the binary is already there', async () => {
    const d = stub("process.stdout.write('SHOULD NOT RUN'); process.exit(1)")
    mkdirSync(join(d, 'dist'))
    writeFileSync(join(d, 'dist', 'electron-bin'), '')
    writeFileSync(join(d, 'path.txt'), 'electron-bin\n')
    const seen: string[] = []
    expect(await ensureElectron({ pkgDir: d, onData: c => seen.push(c) })).toEqual({ path: join(d, 'dist', 'electron-bin'), downloadedMs: 0 })
    expect(seen).toEqual([])
    rmSync(d, { recursive: true, force: true })
  })

  it("names the installer's last line when it fails, so a network error is not a mystery", async () => {
    const d = stub("process.stderr.write('boom: no network\\n'); process.exit(1)")
    expect(await ensureElectron({ pkgDir: d })).toEqual({ error: expect.stringContaining('boom: no network') })
    rmSync(d, { recursive: true, force: true })
  })
})

describe('downloadLine', () => {
  it('is one line a human and the server can both recognise', () => {
    expect(downloadLine('43.7.0')).toMatch(/^obsrv: downloading Electron 43\.7\.0 \(first run after an install/)
    expect(downloadLine('43.7.0')).not.toContain('\n')
  })
})
