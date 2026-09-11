// The dev lane: a checkout's own build, driven through the obsrv-dev MCP
// server, without a publish, an install, a plugin update or a session
// restart (README, "Developing: the dev lane").
//
// One lane per machine, at ~/.obsrv-dev (OBSRV_DEV_HOME overrides):
//
//   checkout  a symlink to the checkout the lane runs; `npm run lane` there points it
//   profile/  the dev app's userData — its own single-instance lock and control.json,
//             so it runs beside an installed Obsrv and the two are never confused
//   bin/      the obsrv-dev proxy, copied here so removing a worktree cannot take it along
//
// Plain CommonJS with no dependencies. `npm run lane` and the proxy require
// it, and so does the MCP server under OBSRV_DEV=1 — from its own checkout,
// since scripts/ never ships in the package and a release never sets the flag.
'use strict'

const { execFileSync } = require('node:child_process')
const { copyFileSync, mkdirSync, readFileSync, readlinkSync, realpathSync, renameSync, rmSync, statSync, symlinkSync } = require('node:fs')
const { homedir } = require('node:os')
const { basename, join } = require('node:path')

const DEV_HOME_ENV = 'OBSRV_DEV_HOME'

/** The lane's home: ~/.obsrv-dev, or OBSRV_DEV_HOME. */
function devHome(env = process.env) {
  return env[DEV_HOME_ENV] || join(homedir(), '.obsrv-dev')
}
const pointerPath = (env = process.env) => join(devHome(env), 'checkout')
const profileDir = (env = process.env) => join(devHome(env), 'profile')
const controlFile = (env = process.env) => join(profileDir(env), 'control.json')
const binDir = (env = process.env) => join(devHome(env), 'bin')

/** Where the lane's pointer points, as written; null when nothing has been pointed yet. */
function laneTarget(env = process.env) {
  try {
    return readlinkSync(pointerPath(env))
  } catch {
    return null
  }
}

/** The checkout the lane runs, as a real path; null when there is none, or it is gone. */
function laneCheckout(env = process.env) {
  try {
    return realpathSync(pointerPath(env))
  } catch {
    return null
  }
}

/**
 * Points the lane at `root`. A new symlink renamed over the old one, so a
 * reader — the proxy, between two calls — never finds no pointer at all.
 */
function pointLaneAt(root, env = process.env) {
  mkdirSync(devHome(env), { recursive: true })
  const tmp = `${pointerPath(env)}.${process.pid}.tmp`
  rmSync(tmp, { force: true })
  symlinkSync(root, tmp)
  renameSync(tmp, pointerPath(env))
}

function mtime(path) {
  try {
    return statSync(path).mtimeMs
  } catch {
    return 0
  }
}

/** When the checkout's MCP server was last built: out/mcp/server.js, which `npm run build` rewrites. */
const serverStamp = root => mtime(join(root, 'out', 'mcp', 'server.js'))

/** The files the app runs from; the newest of them is when the app was last built. */
const APP_BUILD = [
  ['out', 'main', 'index.js'],
  ['out', 'preload', 'app.js'],
  ['out', 'preload', 'sync.js'],
  ['out', 'renderer', 'index.html'],
]
const appStamp = root => Math.max(0, ...APP_BUILD.map(parts => mtime(join(root, ...parts))))

/**
 * Whether a dev app that came up at `startedAt` (its control file's stamp,
 * ISO 8601) is running a build older than the checkout's. An app without the
 * stamp has nothing to compare, and is left alone.
 */
function isStale(startedAt, root) {
  if (!startedAt) return false
  const started = Date.parse(startedAt)
  return Number.isFinite(started) && started < appStamp(root)
}

/**
 * The branch and commit a checkout is on, and whether its tracked files
 * differ from that commit — a build of a dirty tree is not the commit's
 * build, and the label says so. Null outside a git checkout.
 */
function describe(root) {
  try {
    const git = args => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    return {
      branch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
      sha: git(['rev-parse', '--short', 'HEAD']),
      dirty: git(['status', '--porcelain', '--untracked-files=no']) !== '',
    }
  } catch {
    return null
  }
}

/** How the lane names a checkout to a person: its branch and commit (and uncommitted changes), or its folder. */
function laneLabel(root) {
  const d = describe(root)
  return d === null ? basename(root) : `${d.branch} @ ${d.sha}${d.dirty ? ' + uncommitted changes' : ''}`
}

/**
 * How the lane runs a checkout's app: its own GUI entry, on the lane's
 * profile, with agent control on for the session and the lane named — the
 * window's title says "dev lane", so it is never taken for the installed app.
 */
function appLaunch(root, env = process.env) {
  return {
    entry: join(root, 'out', 'main', 'index.js'),
    args: [`--user-data-dir=${profileDir(env)}`],
    env: { OBSRV_AGENT_CONTROL: '1', OBSRV_DEV_LANE: root, OBSRV_DEV_LANE_LABEL: laneLabel(root) },
  }
}

function alive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return !!e && e.code === 'EPERM'
  }
}

/** The dev app running on the lane's profile, if any: its pid, and when it came up. */
function runningApp(env = process.env) {
  try {
    const info = JSON.parse(readFileSync(controlFile(env), 'utf8'))
    if (typeof info.pid === 'number' && alive(info.pid)) return { pid: info.pid, startedAt: info.startedAt }
  } catch {
    // No control file, or one half-written: no app to speak of.
  }
  return null
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

/** Stops a dev app: SIGTERM, then SIGKILL if it has not gone within `graceMs`. Resolves once it is gone. */
async function stopApp(pid, graceMs = 8000) {
  if (!alive(pid)) return
  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    return
  }
  const until = Date.now() + graceMs
  while (Date.now() < until) {
    if (!alive(pid)) return
    await sleep(100)
  }
  try {
    process.kill(pid, 'SIGKILL')
  } catch {
    return
  }
  for (let i = 0; i < 20 && alive(pid); i++) await sleep(100)
}

/**
 * Copies the proxy and this file into the lane's bin/ and answers the
 * proxy's path — the one a session registers, which survives the removal of
 * whatever worktree the lane pointed at.
 */
function installProxy(env = process.env) {
  const dir = binDir(env)
  mkdirSync(dir, { recursive: true })
  for (const file of ['dev-mcp.js', 'devLane.js']) {
    const tmp = join(dir, `${file}.${process.pid}.tmp`)
    copyFileSync(join(__dirname, file), tmp)
    renameSync(tmp, join(dir, file))
  }
  return join(dir, 'dev-mcp.js')
}

module.exports = {
  DEV_HOME_ENV,
  devHome,
  pointerPath,
  profileDir,
  controlFile,
  binDir,
  laneTarget,
  laneCheckout,
  pointLaneAt,
  serverStamp,
  appStamp,
  isStale,
  describe,
  laneLabel,
  appLaunch,
  runningApp,
  stopApp,
  installProxy,
}
