#!/usr/bin/env node
// npm prepack/postpack hook: the repo keeps electron in devDependencies
// (electron-builder refuses it in dependencies — it must never be bundled
// into the app), but npm consumers need it at runtime. So the published
// manifest — and only the published manifest — carries it in dependencies.
// Idempotent in both directions; `node scripts/electron-dep.js to-prod|to-dev`.
'use strict'
const { readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')
const file = join(__dirname, '..', 'package.json')
const pkg = JSON.parse(readFileSync(file, 'utf8'))
const mode = process.argv[2]
const move = (from, to) => {
  if (pkg[from]?.electron) {
    pkg[to] = { ...pkg[to], electron: pkg[from].electron }
    delete pkg[from].electron
    writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n')
    console.error(`electron-dep: electron -> ${to}`)
  }
}
if (mode === 'to-prod') move('devDependencies', 'dependencies')
else if (mode === 'to-dev') move('dependencies', 'devDependencies')
else { console.error('usage: electron-dep.js to-prod|to-dev'); process.exit(2) }
