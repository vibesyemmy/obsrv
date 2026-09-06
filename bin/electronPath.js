// Resolving the Electron binary without letting anything reach stdout.
//
// `require('electron')` returns the binary's path, and downloads the binary
// first when it is missing — the `npx -y getobsrv` first run the README
// documents. It announces that with `console.log('Downloading Electron
// binary...')`, which is stdout, and then spawns its installer with
// `stdio: 'inherit'`, so that goes to stdout too. This CLI promises that
// stdout carries nothing but machine JSON, and a CI run failed exactly there:
//
//   SyntaxError: Unexpected token 'D', "Downloadin"... is not valid JSON
//
// So: work out the path ourselves, which cannot print anything, and only when
// the binary is genuinely absent hand the download to a child process whose
// stdout we redirect to stderr.
'use strict'

const { spawnSync } = require('node:child_process')
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
 * The Electron binary, downloading it first if it is missing, with every byte
 * the download prints sent to stderr.
 *
 * @returns {{ path: string } | { error: string }}
 */
function resolveElectron() {
  let pkgDir
  try {
    pkgDir = dirname(require.resolve('electron/package.json'))
  } catch {
    return { error: 'electron is not installed — run `npm install` in the Obsrv repo first' }
  }
  const override = process.env.ELECTRON_OVERRIDE_DIST_PATH
  const known = electronBinaryPath(pkgDir, override)
  if (known && existsSync(known)) return { path: known }
  // Missing, or a layout we do not recognise. Let the package do its own
  // resolution — including the download — in a child, and keep its stdout off
  // ours. The child prints the path it resolved, which is all we take back.
  const child = spawnSync(process.execPath, ['-e', 'process.stderr.write(String(require("electron")))'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  // Anything the package wrote to stdout was progress, not an answer.
  if (child.stdout && child.stdout.length > 0) process.stderr.write(child.stdout)
  const answer = child.stderr ? child.stderr.toString().trim() : ''
  if (child.status !== 0 || answer === '') {
    if (answer !== '') process.stderr.write(`${answer}\n`)
    return { error: 'electron could not be resolved — run `npm install` in the Obsrv repo first' }
  }
  // The path is the last line: the download's own progress may precede it.
  const resolved = answer.split('\n').pop().trim()
  if (!existsSync(resolved)) return { error: `electron resolved to a path that does not exist: ${resolved}` }
  return { path: resolved }
}

module.exports = { electronBinaryPath, resolveElectron }
