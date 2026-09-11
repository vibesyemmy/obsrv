// Resolving the Electron binary without letting anything reach stdout, and
// fetching it when a fresh install has none.
//
// `require('electron')` returns the binary's path, and downloads the binary
// first when it is missing — Electron 43 has no postinstall; its `index.js`
// runs `install.js` on first use — which is the `npx -y getobsrv` first run
// the README documents. It announces that with `console.log('Downloading
// Electron binary...')`, which is stdout, and then spawns its installer with
// `stdio: 'inherit'`, so that goes to stdout too. This CLI promises that
// stdout carries nothing but machine JSON, and a CI run failed exactly there:
//
//   SyntaxError: Unexpected token 'D', "Downloadin"... is not valid JSON
//
// So: work out the path ourselves, which cannot print anything, and only when
// the binary is genuinely absent run the package's own installer in a child
// whose output we redirect to stderr — behind one line (`downloadLine`) that
// says what is happening, since the download is ~120 MB and on a slow link
// takes minutes: the MCP server killed a first call mid-download and the
// orphaned installer died without extracting, so every later call started
// over (measured 2026-09-11). The server now fetches a missing Electron at
// startup (`ensureElectron`, asynchronous) and a call that arrives meanwhile
// waits for it; the CLI's own synchronous path (`resolveElectron`) remains
// for a CLI run outside the server.
//
// The installer is run directly (`<pkg>/install.js`, what the package's own
// `index.js` does) rather than through `require('electron')` in a `-e`
// child: that child resolved `electron` from the *cwd*, which inside a
// checkout found the checkout's copy and in a user's project found nothing.
'use strict'

const { spawn, spawnSync } = require('node:child_process')
const { existsSync, readFileSync } = require('node:fs')
const { dirname, join } = require('node:path')

/**
 * Where the `electron` package says its binary is, by the same rules the
 * package itself uses. Returns null when the package layout is not the one we
 * know, so the caller can fall back rather than guess.
 *
 * @param {string} pkgDir the `electron` package directory
 * @param {string | undefined} override the value of ELECTRON_OVERRIDE_DIST_PATH
 * @returns {string | null}
 */
function electronBinaryPath(pkgDir, override) {
  const pathFile = join(pkgDir, 'path.txt')
  let relative = ''
  try {
    if (existsSync(pathFile)) relative = readFileSync(pathFile, 'utf8').trim()
  } catch {
    return null
  }
  // The override wins whether or not path.txt exists, exactly as the package
  // does it; there is no download on this branch, so nothing can print.
  if (override) return join(override, relative || 'electron')
  if (!relative) return null
  return join(pkgDir, 'dist', relative)
}

/**
 * The `electron` package directory: OBSRV_ELECTRON_PKG_DIR when set (a
 * stand-in package — the e2e suite's, or another install a user points at),
 * else the one npm resolves from here; null when there is none.
 *
 * @param {NodeJS.ProcessEnv} env
 * @returns {string | null}
 */
function electronPackageDir(env = process.env) {
  if (env.OBSRV_ELECTRON_PKG_DIR) return env.OBSRV_ELECTRON_PKG_DIR
  try {
    return dirname(require.resolve('electron/package.json'))
  } catch {
    return null
  }
}

/** @param {string} pkgDir */
function electronVersion(pkgDir) {
  try {
    return String(JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')).version)
  } catch {
    return 'unknown'
  }
}

const NOT_INSTALLED = 'electron is not installed — run `npm install` in the Obsrv repo first'

/**
 * Whether the binary is there, without touching the network. Absent, it
 * carries the package's version for the sentence that announces a download.
 *
 * @param {string | null} [pkgDir]
 * @param {string | undefined} [override]
 * @returns {{ present: true, path: string, pkgDir: string } | { present: false, pkgDir: string, version: string } | { present: false, error: string }}
 */
function electronStatus(pkgDir = electronPackageDir(), override = process.env.ELECTRON_OVERRIDE_DIST_PATH) {
  if (pkgDir === null || pkgDir === undefined) return { present: false, error: NOT_INSTALLED }
  const known = electronBinaryPath(pkgDir, override)
  if (known && existsSync(known)) return { present: true, path: known, pkgDir }
  return { present: false, pkgDir, version: electronVersion(pkgDir) }
}

/**
 * The one line that announces a download, on the CLI's stderr and the
 * server's: a human sees why nothing answers yet, and the server's killed
 * message recognises it (src/mcp/lib.ts).
 *
 * @param {string} version
 */
function downloadLine(version) {
  return `obsrv: downloading Electron ${version} (first run after an install; ~120 MB), which the tools wait for`
}

/**
 * The line of the installer's output that says what went wrong: the last one
 * that reads as an error, since an uncaught exception ends with node's own
 * version line; else the last non-empty line.
 */
const lastLine = text => {
  const lines = text
    .split(/\r?\n|\r/)
    .map(l => l.trim())
    .filter(l => l.length > 0)
  const error = lines.filter(l => /error|cannot|enoent|econn|refused|failed|timed out|not found/i.test(l)).at(-1)
  return error ?? lines.at(-1) ?? ''
}

/**
 * The binary, fetched first when it is missing: runs the package's own
 * installer in a child, hands everything it prints to `onData` (progress,
 * mostly), and answers once the binary is in place. Resolves at once, with
 * `downloadedMs: 0`, when nothing was missing.
 *
 * @param {{ pkgDir?: string | null, override?: string, onData?: (chunk: string) => void }} [options]
 * @returns {Promise<{ path: string, downloadedMs: number } | { error: string }>}
 */
function ensureElectron({ pkgDir = electronPackageDir(), override = process.env.ELECTRON_OVERRIDE_DIST_PATH, onData } = {}) {
  const before = electronStatus(pkgDir, override)
  if (before.present) return Promise.resolve({ path: before.path, downloadedMs: 0 })
  if (before.error) return Promise.resolve({ error: before.error })
  return new Promise(done => {
    const started = Date.now()
    let printed = ''
    const child = spawn(process.execPath, [join(before.pkgDir, 'install.js')], { cwd: before.pkgDir, stdio: ['ignore', 'pipe', 'pipe'] })
    const take = chunk => {
      const s = String(chunk)
      printed += s
      if (onData) onData(s)
    }
    child.stdout.on('data', take)
    child.stderr.on('data', take)
    child.on('error', err => done({ error: `electron could not be downloaded: ${err.message}` }))
    child.on('close', code => {
      const after = electronStatus(before.pkgDir, override)
      if (after.present) return done({ path: after.path, downloadedMs: Date.now() - started })
      const why = lastLine(printed)
      done({ error: `electron could not be downloaded (installer exit ${code ?? 'unknown'})${why ? `: ${why}` : ''}` })
    })
  })
}

/**
 * The Electron binary for the CLI launcher, synchronously: downloading it
 * first if it is missing, behind the line that says so, with every byte the
 * download prints sent to stderr.
 *
 * @returns {{ path: string } | { error: string }}
 */
function resolveElectron() {
  const status = electronStatus()
  if (status.present) return { path: status.path }
  if (status.error) return { error: status.error }
  process.stderr.write(`${downloadLine(status.version)}\n`)
  const child = spawnSync(process.execPath, [join(status.pkgDir, 'install.js')], { cwd: status.pkgDir, stdio: ['ignore', 'pipe', 'pipe'] })
  // Anything the installer wrote to stdout was progress, not an answer.
  if (child.stdout && child.stdout.length > 0) process.stderr.write(child.stdout)
  if (child.stderr && child.stderr.length > 0) process.stderr.write(child.stderr)
  const after = electronStatus()
  if (after.present) return { path: after.path }
  return { error: `electron could not be downloaded (installer exit ${child.status ?? 'unknown'}) — see the lines above` }
}

module.exports = { electronBinaryPath, electronPackageDir, electronStatus, downloadLine, ensureElectron, resolveElectron }
