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
// whose output never touches our stdout — behind one line (`downloadLine`)
// that says what is happening, since the download is ~120 MB and on a slow
// link takes minutes: the MCP server killed a first call mid-download and the
// orphaned installer died without extracting, so every later call started
// over (measured 2026-09-11). The server now fetches a missing Electron at
// startup (`ensureElectron`, asynchronous) and a call that arrives meanwhile
// waits for it; the CLI's own synchronous path (`resolveElectron`) remains
// for a CLI run outside the server.
//
// Two things about that download, both measured or read from the installer:
//
// - Every Claude session's MCP server resolves the same npx cache folder, and
//   after a plugin update several of them start at once. The installer checks
//   `isInstalled()` once and then extracts into `dist/` regardless, so two of
//   them running together would interleave. An atomic `mkdir` lock
//   (`.obsrv-installing/`, holding the owner's pid) lets one run it; the rest
//   wait for `path.txt`. A lock whose holder is dead is taken over.
// - The orphan that downloaded 123 MB and died had the dead server's pipe as
//   its stdio. The installer is started detached, its output in
//   `obsrv-install.log` beside it, so it outlives whoever started it; the
//   starter watches `path.txt`, not the child.
//
// The installer is run directly (`<pkg>/install.js`, what the package's own
// `index.js` does) rather than through `require('electron')` in a `-e`
// child: that child resolved `electron` from the *cwd*, which inside a
// checkout found the checkout's copy and in a user's project found nothing.
'use strict'

const { spawn, spawnSync } = require('node:child_process')
const { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeFileSync } = require('node:fs')
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

// --- the install lock ---------------------------------------------------------

/** The lock directory inside the package: `mkdir` is atomic, so one process wins. */
const LOCK_DIR = '.obsrv-installing'
/** Where a detached installer writes everything it prints. */
const LOG_FILE = 'obsrv-install.log'
/** A lock without a readable pid yet is trusted for this long: its owner is between mkdir and the write. */
const LOCK_YOUNG_MS = 5_000
/** How long a waiter gives a download before it gives up. */
const DEFAULT_INSTALL_TIMEOUT_MS = 30 * 60_000

/** @param {string} lockDir */
function lockHolderAlive(lockDir) {
  let pid = 0
  try {
    pid = Number(readFileSync(join(lockDir, 'pid'), 'utf8').trim())
  } catch {
    pid = 0
  }
  if (!Number.isInteger(pid) || pid <= 0) {
    try {
      return Date.now() - statSync(lockDir).mtimeMs < LOCK_YOUNG_MS
    } catch {
      return false
    }
  }
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return e && e.code === 'EPERM'
  }
}

/**
 * Takes the install lock. A lock whose holder is dead — its download died
 * with it — is removed and taken over. False when a live process holds it.
 *
 * @param {string} pkgDir
 */
function acquireLock(pkgDir) {
  const lockDir = join(pkgDir, LOCK_DIR)
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      mkdirSync(lockDir)
      writeFileSync(join(lockDir, 'pid'), String(process.pid))
      return true
    } catch (e) {
      if (!e || e.code !== 'EEXIST') throw e
      if (lockHolderAlive(lockDir)) return false
      rmSync(lockDir, { recursive: true, force: true })
    }
  }
  return false
}

/** @param {string} pkgDir */
function releaseLock(pkgDir) {
  rmSync(join(pkgDir, LOCK_DIR), { recursive: true, force: true })
}

/**
 * Starts the package's installer detached, its output in the log file, so it
 * outlives whoever started it. The child is unref'd: the starter's exit does
 * not wait for it, and its exit does not stop it.
 *
 * @param {string} pkgDir
 */
function startInstaller(pkgDir) {
  const out = openSync(join(pkgDir, LOG_FILE), 'w')
  try {
    const child = spawn(process.execPath, [join(pkgDir, 'install.js')], { cwd: pkgDir, detached: true, stdio: ['ignore', out, out] })
    child.unref()
    return child
  } finally {
    closeSync(out)
  }
}

/**
 * The binary, fetched first when it is missing: takes the lock and starts the
 * package's own installer (detached, logging beside it), or waits for the
 * process that holds the lock; hands everything the installer prints to
 * `onData` as it appears in the log; answers once `path.txt` names a binary
 * that exists. Resolves at once, with `downloadedMs: 0`, when nothing was
 * missing.
 *
 * @param {{ pkgDir?: string | null, override?: string, onData?: (chunk: string) => void, pollMs?: number, timeoutMs?: number }} [options]
 * @returns {Promise<{ path: string, downloadedMs: number } | { error: string }>}
 */
function ensureElectron({
  pkgDir = electronPackageDir(),
  override = process.env.ELECTRON_OVERRIDE_DIST_PATH,
  onData,
  pollMs = 500,
  timeoutMs = DEFAULT_INSTALL_TIMEOUT_MS,
} = {}) {
  const before = electronStatus(pkgDir, override)
  if (before.present) return Promise.resolve({ path: before.path, downloadedMs: 0 })
  if (before.error) return Promise.resolve({ error: before.error })
  const dir = before.pkgDir
  const logFile = join(dir, LOG_FILE)
  return new Promise(done => {
    const started = Date.now()
    let owner = false
    /** Set once our own installer has exited: { code } or { error }. */
    let exited = null
    let tookOver = false
    const fail = message => ({ error: `electron could not be downloaded${message ? `: ${message}` : ''}` })
    const start = () => {
      try {
        owner = acquireLock(dir)
      } catch (e) {
        return fail(e.message)
      }
      if (!owner) return null
      exited = null
      try {
        const child = startInstaller(dir)
        child.on('error', err => (exited = { code: null, error: err.message }))
        child.on('exit', code => (exited = exited ?? { code }))
      } catch (e) {
        releaseLock(dir)
        owner = false
        return fail(e.message)
      }
      return null
    }
    const early = start()
    if (early !== null) return done(early)

    let offset = 0
    const logText = () => {
      try {
        return readFileSync(logFile, 'utf8')
      } catch {
        return ''
      }
    }
    const tail = () => {
      if (!onData) return
      const text = logText()
      if (text.length > offset) {
        onData(text.slice(offset))
        offset = text.length
      }
    }
    const finish = result => {
      clearInterval(timer)
      tail()
      if (owner) releaseLock(dir)
      done(result)
    }
    const check = () => {
      tail()
      const now = electronStatus(dir, override)
      if (now.present) return finish({ path: now.path, downloadedMs: Date.now() - started })
      if (owner && exited !== null) {
        const why = exited.error ?? lastLine(logText())
        return finish(fail(`installer exit ${exited.code ?? 'unknown'}${why ? `: ${why}` : ''}`))
      }
      if (!owner && !existsSync(join(dir, LOCK_DIR))) {
        // The process we waited on finished without a binary: its download
        // failed, or it died. Take over once; a second failure is an answer.
        if (tookOver) return finish(fail(`another process's download ended without a binary — see ${logFile}`))
        tookOver = true
        const problem = start()
        if (problem !== null) return finish(problem)
      }
      if (Date.now() - started > timeoutMs) return finish(fail(`no binary after ${Math.round(timeoutMs / 60_000)} min — see ${logFile}`))
    }
    const timer = setInterval(check, pollMs)
  })
}

/** A synchronous sleep, for the CLI's wait on another process's download. */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/**
 * The Electron binary for the CLI launcher, synchronously: downloading it
 * first if it is missing, behind the line that says so, with every byte the
 * download prints sent to stderr. Under the same lock as the server's
 * download: when another process is fetching it, this waits for that.
 *
 * @returns {{ path: string } | { error: string }}
 */
function resolveElectron() {
  const status = electronStatus()
  if (status.present) return { path: status.path }
  if (status.error) return { error: status.error }
  const dir = status.pkgDir
  process.stderr.write(`${downloadLine(status.version)}\n`)
  let owner = false
  try {
    owner = acquireLock(dir)
  } catch (e) {
    return { error: `electron could not be downloaded: ${e.message}` }
  }
  if (owner) {
    const child = spawnSync(process.execPath, [join(dir, 'install.js')], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] })
    // Anything the installer wrote to stdout was progress, not an answer.
    if (child.stdout && child.stdout.length > 0) process.stderr.write(child.stdout)
    if (child.stderr && child.stderr.length > 0) process.stderr.write(child.stderr)
    releaseLock(dir)
    const after = electronStatus()
    if (after.present) return { path: after.path }
    return { error: `electron could not be downloaded (installer exit ${child.status ?? 'unknown'}) — see the lines above` }
  }
  process.stderr.write(`obsrv: another obsrv process is downloading it; waiting\n`)
  const deadline = Date.now() + DEFAULT_INSTALL_TIMEOUT_MS
  while (Date.now() < deadline) {
    sleepSync(500)
    const now = electronStatus()
    if (now.present) return { path: now.path }
    if (!existsSync(join(dir, LOCK_DIR))) break
  }
  const after = electronStatus()
  if (after.present) return { path: after.path }
  return { error: `electron could not be downloaded: the other process's download ended without a binary — see ${join(dir, LOG_FILE)}` }
}

module.exports = { electronBinaryPath, electronPackageDir, electronStatus, downloadLine, ensureElectron, resolveElectron }
