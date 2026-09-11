// Keeps the Claude Code plugin manifests at the package version. Runs as the
// `version` lifecycle script, so `npm version` stages them with the bump.
//
// The marketplace entry's source is pinned to a tag rather than `./`: a
// relative source hands out whatever the marketplace clone is at, which
// between releases is main with docs for flags not yet on npm, and which is
// stale until the user runs `claude plugin marketplace update`. A tag
// resolves to the release, and only that.
//
// The tag is `plugin-v<version>`, not the release's `v<version>`: it points at
// the generated `plugin` branch, which carries the skill and the manifests
// alone. Pointing at the release tag handed every user the whole development
// tree *and* an `npm install` of it into their plugin cache — 263 MB a version
// and never pruned. See scripts/build-plugin-branch.js, which creates that tag
// and must run after `npm version`.
//
// A `url` source with an explicit https:// clone URL, not a `github` one:
// Claude Code clones a github source over SSH (`git@github.com:`), which
// fails outright on a machine with no key for it — measured, the first
// `claude plugin update` after this pin was introduced died with
// "Permission denied (publickey)". The repository is public, and an
// anonymous HTTPS clone of the tag needs no credentials at all.
//
// The MCP registration (`.mcp.json`, which is both the plugin's and, in a
// checkout, the project's) is pinned to the package version and tells npm
// where its project is: `npx -y --prefix / getobsrv@<version> mcp`. Unpinned,
// `npx getobsrv` run inside this checkout resolves to the checkout itself —
// npm links a project into the npx cache when the requested name is the
// project's own — so every session in the repo ran whatever `out/` held, never
// the release (measured 2026-09-11: a 0.49.0 build answered for "0.50.0"). A
// pin alone does not help: a version the checkout satisfies is judged already
// local, and its bin is not found. `--prefix /` makes npm look for its project
// at the filesystem root, which has none, so the spec is fetched from the
// registry wherever the session runs; the bin still runs in the session's cwd.
const { readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

const cloneUrl = 'https://github.com/vibesyemmy/obsrv.git'

/** The MCP server entry the plugin (and a checkout) registers, at a version. */
function mcpServer(version) {
  return { command: 'npx', args: ['-y', '--prefix', '/', `getobsrv@${version}`, 'mcp'] }
}

/** Rewrites the manifests under `root` to its package.json version; returns the version. */
function sync(root) {
  const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
  for (const rel of ['.claude-plugin/plugin.json', '.claude-plugin/marketplace.json', '.mcp.json']) {
    const file = join(root, rel)
    const json = JSON.parse(readFileSync(file, 'utf8'))
    if (json.version !== undefined) json.version = version
    if (Array.isArray(json.plugins)) {
      for (const p of json.plugins) {
        p.version = version
        p.source = { source: 'url', url: cloneUrl, ref: `plugin-v${version}` }
      }
    }
    if (json.mcpServers && json.mcpServers.obsrv) json.mcpServers.obsrv = mcpServer(version)
    writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`)
  }
  return version
}

module.exports = { sync, mcpServer }

if (require.main === module) {
  const version = sync(join(__dirname, '..'))
  console.log(`plugin manifests at ${version}, marketplace source pinned to plugin-v${version}, MCP server pinned to getobsrv@${version}`)
}
