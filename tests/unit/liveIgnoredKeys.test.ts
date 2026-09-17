import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * A live audit, lint or inspect measures the screen already in force, so an
 * input it doesn't use has to be named in the reply, not dropped. Live audit
 * and lint dropped `rotate`, and live inspect dropped both `orientation` and
 * `rotate`, with no note (Wren's release sweep of #178 and her read of #207).
 * Each "ignored in live mode" list was written by hand along with its tool, and
 * a field added to the schema later reached none of them.
 *
 * Read from the server's source, as preloadChannelsHandled.test.ts reads
 * the preload: every key a tool's input schema declares must be read by its
 * live handler, sent headless with the custom dimensions, or named in that
 * handler's ignored list. obsrv_snap is not here, because its routing is
 * `planSnapPath`, which mcpLib.test.ts covers.
 */
const SRC = readFileSync(resolve(__dirname, '../../src/mcp/server.ts'), 'utf8')

/** From a line that starts with `start` to the first unindented closing brace after it. */
function topLevelBlock(start: string): string {
  const at = SRC.indexOf(`\n${start}`)
  expect(at, `\`${start}\` not found in src/mcp/server.ts`).toBeGreaterThanOrEqual(0)
  return SRC.slice(at, SRC.indexOf('\n}', at + 1))
}

function accounted(tool: 'audit' | 'lint' | 'inspect') {
  const Tool = tool[0]!.toUpperCase() + tool.slice(1)
  const declared = [...topLevelBlock(`const ${tool}InputShape = {`).matchAll(/^ {2}(\w+):/gm)].map(m => m[1]!)
  const live = topLevelBlock(`async function live${Tool}(`)
  const read = new Set([...live.matchAll(/\binput\.(\w+)/g)].map(m => m[1]!))
  const list = /for \(const k of \[([^\]]*)\] as const\) \{\s*if \(input\[k\] !== undefined\) notes\.push\(`\\`\$\{k\}\\` is headless-only and was ignored in live mode/.exec(live)
  expect(list, `live${Tool} has no "ignored in live mode" list`).not.toBeNull()
  const ignored = new Set([...list![1]!.matchAll(/'(\w+)'/g)].map(m => m[1]!))
  const registered = SRC.indexOf(`'obsrv_${tool}',`)
  expect(registered, `obsrv_${tool} is not registered`).toBeGreaterThanOrEqual(0)
  const customLine = /const custom = ([^\n]+)/.exec(SRC.slice(registered))
  expect(customLine, `obsrv_${tool} has no custom-dimensions routing`).not.toBeNull()
  const headless = new Set([...customLine![1]!.matchAll(/\binput\.(\w+) !== undefined/g)].map(m => m[1]!))
  return { declared, read, ignored, headless }
}

describe('a live audit, lint or inspect', () => {
  for (const tool of ['audit', 'lint', 'inspect'] as const) {
    it(`obsrv_${tool}: uses every input it declares, sends it headless, or says it ignored it`, () => {
      const { declared, read, ignored, headless } = accounted(tool)
      // Not vacuous: each set is what the source really holds today.
      expect(declared.length, 'schema keys parsed').toBeGreaterThan(10)
      expect(read.has('url'), 'the live handler reads url').toBe(true)
      expect(ignored.has('preset'), 'the ignored list parsed').toBe(true)
      expect([...headless].sort(), 'custom dimensions parsed').toEqual(['deviceScaleFactor', 'diagonalInches', 'height', 'width'])
      // `mode` picks the path itself.
      const dropped = declared.filter(k => k !== 'mode' && !read.has(k) && !ignored.has(k) && !headless.has(k))
      expect(dropped, `live obsrv_${tool} drops these without a note`).toEqual([])
    })
  }
})
