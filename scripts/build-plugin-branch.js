// Builds the `plugin` branch: the plugin, and nothing else.
//
// Claude Code installs a plugin by fetching its source into
// `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/` — and if the
// fetched tree has a package.json with dependencies, it installs them there.
// Pointing the marketplace at this repo's release tag therefore handed every
// user the whole development tree plus a full `npm install`, devDependencies
// included: **263 MB per version, never pruned** (measured 2026-09-07, four
// versions deep at 1.0 GB — lucide-react 40 MB, electron-winstaller 29 MB,
// typescript 23 MB, playwright-core 13 MB). None of it is reachable from the
// plugin: the MCP server runs `npx -y getobsrv mcp`, which resolves from the
// registry, and the skill is markdown.
//
// A plugin needs no package.json at all — `frontend-design` in the official
// marketplace ships LICENSE, README.md, .claude-plugin/plugin.json and
// skills/, and installs to 48 KB. So this writes exactly that shape to an
// orphan branch, where there is no package.json for the installer to find and
// the question of what triggers it stops mattering.
//
// Written with plumbing (hash-object / update-index / commit-tree) against a
// temporary index rather than by checking the branch out: this runs in the
// middle of a release, and a script that switches branches under a working
// tree someone is mid-release in is a script that eventually eats an
// uncommitted change.
//
// Run it after `npm version`, which is what stamps the version this reads:
//
//   npm version minor
//   npm run plugin:branch      # this script
//   git push origin main       # then, once main is green:
//   git push origin v<version> plugin-v<version>
//
// The marketplace entry on `main` is what `claude plugin marketplace add`
// reads, and `sync-plugin-version.js` pins its source to `plugin-v<version>`
// — so that tag must be pushed, exactly as the release tag must be.

const { execFileSync } = require('node:child_process')
const { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, relative, resolve, sep } = require('node:path')

const root = resolve(__dirname, '..')
const BRANCH = 'plugin'

/** Files copied verbatim from the repo root. */
const FILES = ['.claude-plugin/plugin.json', '.mcp.json', 'LICENSE']
/** Directories copied whole. */
const DIRS = ['skills']

const git = (args, env) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8', env: { ...process.env, ...env } }).trim()

/** Every file in `dir`, repo-relative, in a stable order. */
function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full))
    else if (entry.isFile()) out.push(full)
  }
  return out
}

/**
 * What the branch holds: the manifests, the skill, the licence, and a README
 * of its own. The repo's README is 400 lines about the app and its flags and
 * would only mislead someone who landed here from the plugin cache.
 */
function pluginTree(version) {
  const files = []
  for (const rel of FILES) files.push({ path: rel, file: join(root, rel) })
  for (const dir of DIRS) for (const file of walk(join(root, dir))) files.push({ path: relative(root, file).split(sep).join('/'), file })
  const entries = files.map(({ path, file }) => ({
    path,
    // Preserve the executable bit; git has only the two modes.
    mode: statSync(file).mode & 0o111 ? '100755' : '100644',
    content: readFileSync(file),
  }))
  entries.push({
    path: 'README.md',
    mode: '100644',
    content: Buffer.from(
      `# Obsrv — Claude Code plugin\n\n` +
        `This branch is generated. It carries the plugin and nothing else — the skill, the\n` +
        `manifests and the MCP registration — so installing it does not copy a development\n` +
        `tree or run \`npm install\` into your plugin cache.\n\n` +
        `The source, the app and the CLI live on [\`main\`](https://github.com/vibesyemmy/obsrv).\n` +
        `The MCP server it registers is the \`getobsrv\` package on npm, fetched with \`npx\`;\n` +
        `nothing here is the implementation.\n\n` +
        `Built from \`v${version}\` by \`scripts/build-plugin-branch.js\`. Do not commit to this\n` +
        `branch by hand — the next release overwrites it.\n`,
    ),
  })
  return entries.sort((a, b) => (a.path < b.path ? -1 : 1))
}

function main() {
  const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
  const tag = `plugin-v${version}`
  const entries = pluginTree(version)

  // A temporary index, so the real one — which may hold a release in progress
  // — is never touched.
  const dir = mkdtempSync(join(tmpdir(), 'obsrv-plugin-branch-'))
  const env = { GIT_INDEX_FILE: join(dir, 'index') }
  try {
    for (const entry of entries) {
      const blob = execFileSync('git', ['hash-object', '-w', '--stdin'], { cwd: root, input: entry.content, encoding: 'utf8' }).trim()
      git(['update-index', '--add', '--cacheinfo', `${entry.mode},${blob},${entry.path}`], env)
    }
    const tree = git(['write-tree'], env)

    let parent = null
    try {
      parent = git(['rev-parse', '--verify', `refs/heads/${BRANCH}`])
    } catch {
      // No branch yet: this commit is its root.
    }
    // Nothing changed since the last release's tree — commit anyway would add
    // an empty commit per version, so move the tag and stop.
    const unchanged = parent !== null && git(['rev-parse', `${parent}^{tree}`]) === tree
    const commit = unchanged
      ? parent
      : git(['commit-tree', tree, ...(parent ? ['-p', parent] : []), '-m', `plugin ${version}`])

    git(['update-ref', `refs/heads/${BRANCH}`, commit])
    git(['tag', '-f', tag, commit])
    const bytes = entries.reduce((n, e) => n + e.content.length, 0)
    console.log(
      `${BRANCH} branch at ${commit.slice(0, 7)}${unchanged ? ' (tree unchanged)' : ''}, tagged ${tag}: ` +
        `${entries.length} files, ${(bytes / 1024).toFixed(0)} KB`,
    )
    console.log(`push it with the release tag: git push origin main ${tag} v${version}`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

module.exports = { pluginTree, BRANCH }

if (require.main === module) main()
