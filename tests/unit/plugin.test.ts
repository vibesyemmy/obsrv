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
    expect(market.plugins[0]).toMatchObject({
      name: 'obsrv',
      version: pkg.version,
      source: { source: 'github', repo: 'vibesyemmy/obsrv', ref: `v${pkg.version}` },
    })
  })
  it('the manifests ship in the npm package', () => {
    const files: string[] = read('package.json').files
    expect(files).toEqual(expect.arrayContaining(['.claude-plugin', '.mcp.json', 'skills']))
  })
})
