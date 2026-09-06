// Keeps the Claude Code plugin manifests at the package version. Runs as the
// `version` lifecycle script, so `npm version` stages them with the bump.
const { readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')
const root = join(__dirname, '..')
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
for (const rel of ['.claude-plugin/plugin.json', '.claude-plugin/marketplace.json']) {
  const file = join(root, rel)
  const json = JSON.parse(readFileSync(file, 'utf8'))
  if (json.version !== undefined) json.version = version
  if (Array.isArray(json.plugins)) for (const p of json.plugins) p.version = version
  writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`)
}
console.log(`plugin manifests at ${version}`)
