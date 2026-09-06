// Keeps the Claude Code plugin manifests at the package version. Runs as the
// `version` lifecycle script, so `npm version` stages them with the bump.
//
// The marketplace entry's source is pinned to the release tag rather than
// `./`: a relative source hands out whatever the marketplace clone is at,
// which between releases is main with docs for flags not yet on npm, and
// which is stale until the user runs `claude plugin marketplace update`. A
// tag resolves to the release, and only that. The tag is the one `npm
// version` creates next; it exists on the remote once the release procedure
// pushes it.
const { readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')
const root = join(__dirname, '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const version = pkg.version
const repo = 'vibesyemmy/obsrv'
for (const rel of ['.claude-plugin/plugin.json', '.claude-plugin/marketplace.json']) {
  const file = join(root, rel)
  const json = JSON.parse(readFileSync(file, 'utf8'))
  if (json.version !== undefined) json.version = version
  if (Array.isArray(json.plugins)) {
    for (const p of json.plugins) {
      p.version = version
      p.source = { source: 'github', repo, ref: `v${version}` }
    }
  }
  writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`)
}
console.log(`plugin manifests at ${version}, marketplace source pinned to v${version}`)
