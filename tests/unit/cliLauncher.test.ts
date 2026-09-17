import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { usage } from '../../src/cli/args'

/**
 * `obsrv --version` is answered by the plain-Node launcher, before it looks
 * for the built entry or the Electron binary. A version question must not
 * need a build or a 200 MB download to be answerable — it is the first thing
 * a bug report asks for, and the machine asking may be exactly the one where
 * the build or the download is what went wrong.
 *
 * The fixture is the launcher copied beside a package.json of its own, with no
 * out/ and no node_modules: every route through Electron fails there, so a
 * version on stdout proves the launcher never took one.
 */
const launcherFixture = (version: string): string => {
  const dir = mkdtempSync(join(tmpdir(), 'obsrv-launcher-'))
  mkdirSync(join(dir, 'bin'))
  for (const file of ['obsrv.js', 'electronPath.js']) copyFileSync(join(__dirname, '..', '..', 'bin', file), join(dir, 'bin', file))
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify({ name: 'getobsrv', version })}\n`)
  return dir
}

const run = (dir: string, ...argv: string[]): { status: number | null; stdout: string; stderr: string } => {
  const r = spawnSync(process.execPath, [join(dir, 'bin', 'obsrv.js'), ...argv], { encoding: 'utf8' })
  return { status: r.status, stdout: r.stdout, stderr: r.stderr }
}

describe('bin/obsrv.js --version', () => {
  it('prints the package version alone on stdout, with no build and no Electron', () => {
    const dir = launcherFixture('9.9.9-fixture')
    try {
      expect(run(dir, '--version')).toEqual({ status: 0, stdout: '9.9.9-fixture\n', stderr: '' })
      expect(run(dir, '-v')).toEqual({ status: 0, stdout: '9.9.9-fixture\n', stderr: '' })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('bin/obsrv.js --help', () => {
  /**
   * `obsrv --help`, and a bare `obsrv`, are answered by the launcher too: on a
   * fresh install the Electron lookup below it is a ~120 MB download, and a
   * stranger's first command waited for it (chore-cli-help-downloads-electron,
   * measured in the 0.61.0 RC verify). Run from the repo against a stand-in
   * `electron` package, as rotateRefused.test.ts does, whose binary records that
   * it was reached. A regression fails here with nothing launched.
   */
  const ROOT = join(__dirname, '..', '..')
  const BIN = join(ROOT, 'bin', 'obsrv.js')

  it("prints the CLI's own usage on stdout, exits 0, and never reaches Electron", () => {
    expect(existsSync(join(ROOT, 'out', 'cli', 'args.js')), 'out/cli/args.js is missing: run npm run build').toBe(true)
    const stub = mkdtempSync(join(tmpdir(), 'obsrv-help-'))
    const reached = join(stub, 'reached')
    mkdirSync(join(stub, 'dist'))
    writeFileSync(join(stub, 'path.txt'), 'stand-in\n')
    writeFileSync(join(stub, 'dist', 'stand-in'), `#!/bin/sh\necho "$@" >> '${reached}'\nexit 3\n`)
    chmodSync(join(stub, 'dist', 'stand-in'), 0o755)
    const env = { ...process.env, OBSRV_ELECTRON_PKG_DIR: stub }
    try {
      for (const argv of [['--help'], ['-h'], ['help'], []]) {
        const r = spawnSync(process.execPath, [BIN, ...argv], { encoding: 'utf8', env })
        // The same text the built CLI prints, from the same function.
        expect({ status: r.status, stdout: r.stdout, stderr: r.stderr }, argv.join(' ') || '(no arguments)').toEqual({ status: 0, stdout: `${usage()}\n`, stderr: '' })
      }
      expect(existsSync(reached), 'a help request reached the Electron binary').toBe(false)
      // Not vacuous: a command that needs Electron does reach the stand-in.
      spawnSync(process.execPath, [BIN, 'snap', 'http://127.0.0.1:9/'], { encoding: 'utf8', env })
      expect(existsSync(reached), 'snap never reached the stand-in, so the help arms prove nothing').toBe(true)
    } finally {
      rmSync(stub, { recursive: true, force: true })
    }
  })
})

