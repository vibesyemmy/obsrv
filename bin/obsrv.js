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
const { resolveElectron } = require('./electronPath.js')

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

// `obsrv uninstall` lists what Obsrv has written on this machine. Plain node
// too: someone removing Obsrv should not have to download Electron to be told
// where its data is, and this command renders nothing.
if (process.argv[2] === 'uninstall') {
  process.argv.splice(2, 1)
  require('./uninstall.js')
  return
}

// `obsrv --version` is answered here, before the build or the Electron binary
// is looked for: a version question must not need either. It is the first
// thing a bug report asks for, and the machine asking may be the one where
// the build or the download is what went wrong. The built entry answers the
// same flag too (src/cli/args.ts), for anyone running it under Electron
// directly.
if (process.argv[2] === '--version' || process.argv[2] === '-v') {
  process.stdout.write(`${require('../package.json').version}\n`)
  return
}

// `obsrv --help`, and a bare `obsrv`, are answered here too, for the same
// reason. On a fresh install the next step below is a ~120 MB download, and a
// stranger's first command waited for it before reading the flag list
// (measured in the 0.61.0 RC verify, cli-cold). The words are the CLI's own:
// its argument parser, compiled for plain Node by the MCP build
// (out/cli/args.js), decides what a help request is and writes the text, so
// the two cannot drift. A tree without that file falls through to the CLI,
// which answers the same after the Electron lookup.
if ([undefined, 'help', '--help', '-h'].includes(process.argv[2])) {
  let help = null
  try {
    const parsed = require('../out/cli/args.js').parseArgs(process.argv.slice(2))
    if (parsed.command === 'help') help = parsed.text
  } catch {
    // Not built, or not a request the parser reads as help: the CLI answers.
  }
  if (help !== null) {
    process.stdout.write(`${help}\n`)
    return
  }
}

const cliEntry = join(__dirname, '..', 'out', 'main', 'cli.js')
if (!existsSync(cliEntry)) {
  console.error('obsrv: out/main/cli.js is missing — run `npm run build` in the Obsrv repo first')
  process.exit(1)
}

// Not `require('electron')` directly: when the binary is missing that both
// prints to stdout and spawns an installer that inherits it, and stdout here
// is machine JSON. See bin/electronPath.js.
const resolved = resolveElectron()
if (resolved.error) {
  console.error(`obsrv: ${resolved.error}`)
  process.exit(1)
}
const electron = resolved.path

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
