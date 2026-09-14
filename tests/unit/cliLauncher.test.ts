import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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
