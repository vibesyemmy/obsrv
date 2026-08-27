#!/usr/bin/env node
// Plain-Node launcher for the headless Obsrv CLI: resolves the Electron
// binary and re-runs the built entry inside it, forwarding argv (behind `--`
// so Chromium never eats our flags), stdio, and the exit code.
//
// Prerequisites: `npm install` and `npm run build` in the Obsrv repo — the
// launcher runs the *built* out/main/cli.js, never the TypeScript sources.
'use strict'

const { spawn } = require('node:child_process')
const { existsSync, mkdtempSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')

// `obsrv mcp` serves the MCP server (plain node, no Electron) so one npx
// invocation covers both: `npx -y getobsrv mcp`.
if (process.argv[2] === 'mcp') {
  process.argv.splice(2, 1)
  require('./obsrv-mcp.js')
  return
}

// `obsrv install-skill` copies the packaged Claude Code skill into the user's
// skills directory. Also plain node — it never renders anything.
if (process.argv[2] === 'install-skill') {
  process.argv.splice(2, 1)
  require('./install-skill.js')
  return
}

const cliEntry = join(__dirname, '..', 'out', 'main', 'cli.js')
if (!existsSync(cliEntry)) {
  console.error('obsrv: out/main/cli.js is missing — run `npm run build` in the Obsrv repo first')
  process.exit(1)
}

let electron
try {
  // Under plain node, require('electron') resolves to the binary's path.
  electron = require('electron')
} catch {
  console.error('obsrv: electron is not installed — run `npm install` in the Obsrv repo first')
  process.exit(1)
}
if (typeof electron !== 'string') {
  console.error('obsrv: require("electron") did not resolve to a binary path (already inside Electron?)')
  process.exit(1)
}

const env = { ...process.env }
// Must boot the real Electron runtime, not Node-mode.
delete env.ELECTRON_RUN_AS_NODE

// The launcher owns the throwaway user-data dir: Chromium flushes profile
// files (Session Storage, Local State) *after* the last main-process JS runs,
// so the Electron child cannot reliably delete its own profile — the plain
// Node parent, which outlives Chromium, can.
const userData = mkdtempSync(join(tmpdir(), 'obsrv-cli-'))
env.OBSRV_CLI_USER_DATA = userData
const cleanup = () => {
  try {
    rmSync(userData, { recursive: true, force: true })
  } catch {
    // Best-effort removal of a tmp dir.
  }
}

const child = spawn(electron, [cliEntry, '--', ...process.argv.slice(2)], { stdio: 'inherit', env })
child.on('error', err => {
  console.error(`obsrv: failed to launch electron: ${err.message}`)
  cleanup()
  process.exit(1)
})
child.on('exit', (code, signal) => {
  cleanup()
  // A run we forwarded a signal into is not a success, even though Chromium's
  // native SIGTERM shutdown reports exit code 0.
  process.exit(signal || signalled ? 1 : code ?? 1)
})

// Forward termination to the Electron child rather than dying and orphaning
// it; the child's exit then drives our own (and the cleanup) above.
let signalled = false
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    signalled = true
    child.kill(signal)
  })
}
