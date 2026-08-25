#!/usr/bin/env node
// Plain-Node launcher for the headless Obsrv CLI: resolves the Electron
// binary and re-runs the built entry inside it, forwarding argv (behind `--`
// so Chromium never eats our flags), stdio, and the exit code.
//
// Prerequisites: `npm install` and `npm run build` in the Obsrv repo — the
// launcher runs the *built* out/main/cli.js, never the TypeScript sources.
'use strict'

const { spawn } = require('node:child_process')
const { existsSync } = require('node:fs')
const { join } = require('node:path')

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

const child = spawn(electron, [cliEntry, '--', ...process.argv.slice(2)], { stdio: 'inherit', env })
child.on('error', err => {
  console.error(`obsrv: failed to launch electron: ${err.message}`)
  process.exit(1)
})
child.on('exit', (code, signal) => process.exit(signal ? 1 : code ?? 1))
