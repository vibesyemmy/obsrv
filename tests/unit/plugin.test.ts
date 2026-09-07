import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

/**
 * The repo is a Claude Code plugin: `.claude-plugin/plugin.json` names it, the
 * skills directory carries the skill, `.mcp.json` registers the MCP server,
 * and the marketplace file lets `claude plugin marketplace add` find it. The
 * manifests must agree with package.json and with each other.
 */
const root = resolve(__dirname, '../..')
const read = (rel: string): any => JSON.parse(readFileSync(join(root, rel), 'utf8'))

describe('the Claude Code plugin', () => {
  it('has a manifest at the package version, and the skill it advertises exists', () => {
    const pkg = read('package.json')
    const plugin = read('.claude-plugin/plugin.json')
    expect(plugin.name).toBe('obsrv')
    expect(plugin.version).toBe(pkg.version)
    expect(existsSync(join(root, 'skills/obsrv-screens/SKILL.md'))).toBe(true)
  })
  it('registers the MCP server the way the README installs it', () => {
    const mcp = read('.mcp.json')
    expect(mcp.mcpServers.obsrv).toEqual({ command: 'npx', args: ['-y', 'getobsrv', 'mcp'] })
  })
  it('the marketplace lists this plugin at the same version, sourced from that version\'s release tag', () => {
    const pkg = read('package.json')
    const market = read('.claude-plugin/marketplace.json')
    expect(market.plugins).toHaveLength(1)
    // A tag, not `./`: a relative source hands out whatever the marketplace
    // clone is at, which between releases is main. The tag is the release.
    // And an https:// url source, not a github one: Claude Code clones a
    // github source over SSH, which fails on a machine with no key for it.
    expect(market.plugins[0]).toMatchObject({
      name: 'obsrv',
      version: pkg.version,
      // `plugin-v`, not `v`: the release tag is the whole development tree, and
      // Claude Code runs `npm install` in whatever it fetches — 263 MB a
      // version in the user's plugin cache. See build-plugin-branch.js.
      source: { source: 'url', url: 'https://github.com/vibesyemmy/obsrv.git', ref: `plugin-v${pkg.version}` },
    })
    expect(JSON.stringify(market)).not.toContain('git@github.com')
  })
  it('the manifests ship in the npm package', () => {
    const files: string[] = read('package.json').files
    expect(files).toEqual(expect.arrayContaining(['.claude-plugin', '.mcp.json', 'skills']))
  })
})

describe('the plugin branch', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { pluginTree } = require('../../scripts/build-plugin-branch.js') as {
    pluginTree: (v: string) => Array<{ path: string; mode: string; content: Buffer }>
  }

  it('carries the skill, the manifests and the licence', () => {
    const paths = pluginTree('9.9.9').map(e => e.path)
    expect(paths).toEqual(expect.arrayContaining(['.claude-plugin/plugin.json', '.mcp.json', 'LICENSE', 'README.md', 'skills/obsrv-screens/SKILL.md']))
  })

  it('carries no package.json, which is what makes the install skip node_modules', () => {
    // The whole point of the branch. A fetched tree with dependencies gets an
    // `npm install` — devDependencies included — into the user's plugin cache.
    const paths = pluginTree('9.9.9').map(e => e.path)
    expect(paths).not.toContain('package.json')
    expect(paths).not.toContain('package-lock.json')
    expect(paths.some(p => p.startsWith('src/') || p.startsWith('tests/') || p.startsWith('node_modules/'))).toBe(false)
  })

  it('is small enough that a cached version costs nothing to keep', () => {
    const bytes = pluginTree('9.9.9').reduce((n, e) => n + e.content.length, 0)
    expect(bytes).toBeLessThan(512 * 1024)
  })

  it('gives the branch a README of its own, naming where the source lives', () => {
    const readme = pluginTree('9.9.9').find(e => e.path === 'README.md')!.content.toString()
    expect(readme).toContain('v9.9.9')
    expect(readme).toContain('generated')
    expect(readme).toContain('github.com/vibesyemmy/obsrv')
  })
})
