import { test, expect } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

/**
 * A structural guard, not a behavioural one: the headless CLI and the MCP
 * server must not be able to reach the releases API at all. The MCP server
 * speaks a stdio protocol where a stray byte on stdout is a bug, and a CI
 * render has no business calling GitHub.
 *
 * This lives in the e2e project, not unit, because it asserts on build output:
 * CI runs the unit suite *before* the build step, so a unit test would only
 * ever pass on a machine that happened to have a stale `out/` lying around.
 */
const ROOT = resolve(__dirname, '../..')

/** `bin/obsrv.js` runs out/main/cli.js; `bin/obsrv-mcp.js` runs out/mcp/server.js. */
const ENTRIES = ['out/main/cli.js', 'out/mcp/server.js']

/**
 * The entry plus every sibling chunk it imports — electron-vite splits shared
 * code out, so checking the entry alone would miss an import of the update
 * module through a chunk.
 */
function bundleSources(entryRel: string): string[] {
  const entryPath = resolve(ROOT, entryRel)
  const source = readFileSync(entryPath, 'utf8')
  const dir = dirname(entryPath)
  const sources = [source]
  for (const m of source.matchAll(/from\s*["'](\.\/[^"']+\.js)["']/g)) {
    const chunk = resolve(dir, m[1]!)
    if (existsSync(chunk)) sources.push(readFileSync(chunk, 'utf8'))
  }
  return sources
}

for (const rel of ENTRIES) {
  test(`${rel} contains no update-check code`, () => {
    const path = resolve(ROOT, rel)
    // Guard rather than skip: a renamed output would otherwise pass silently.
    expect(existsSync(path), `${rel} missing — run npm run build first`).toBe(true)
    for (const source of bundleSources(rel)) {
      expect(source).not.toContain('api.github.com')
      expect(source).not.toContain('OBSRV_RELEASES_API')
    }
  })
}
