import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Every published MCP tool is named in both documents a user actually reads.
 *
 * **Bought by a defect, not by an audit.** `obsrv_flow` shipped into
 * `docs/public-shape.json`, into `tests/e2e/mcp.spec.ts`'s tool list and into
 * `docs/breaking-changes.md` — and into **neither** `README.md` nor the skill.
 * Four places get touched when a tool is added and the two a user reads are not
 * among them, so for a while Obsrv had a tool nobody could discover. Nothing
 * noticed, because `publicShape.test.ts` guards the shape and `mcp.spec.ts`
 * guards the live list, and no guard asks whether either is documented.
 *
 * It keys off `docs/public-shape.json` rather than importing the server: that
 * file is already the canonical list of published tools and is already guarded
 * against drifting from the registration, so this cannot disagree with the real
 * one, and it needs no stdio server in a unit test.
 */
const ROOT = join(__dirname, '..', '..')
const read = (...p: string[]): string => readFileSync(join(ROOT, ...p), 'utf8')

const SURFACES: Array<[label: string, path: string[]]> = [
  ['README.md', ['README.md']],
  ['the skill', ['skills', 'obsrv-screens', 'SKILL.md']],
]

describe('the documents a user reads', () => {
  const tools = Object.keys(JSON.parse(read('docs', 'public-shape.json')) as Record<string, unknown>).sort()

  // The guard's own floor. A snapshot that parsed to `{}` — a truncated write, a
  // shape change that moved the tools under a wrapper key — would leave the loop
  // below iterating nothing and passing on any documentation at all. That is
  // exactly how this repo's root `tsconfig.json` checks zero files and exits 0,
  // and a guard that cannot refuse is not a guard.
  it('reads a real list of tools, so the checks below cannot pass vacuously', () => {
    expect(tools.length, 'docs/public-shape.json named no tools — the check below would be empty').toBeGreaterThanOrEqual(9)
    expect(tools).toContain('obsrv_flow')
  })

  for (const [label, path] of SURFACES) {
    it(`names every published tool in ${label}`, () => {
      const doc = read(...path)
      // Named one by one rather than as a set difference: the failure message
      // should say which tool is missing from which document, because that is
      // the whole content of the defect this test exists for.
      for (const tool of tools) {
        expect(doc, `${label} does not mention ${tool}`).toContain(tool)
      }
    })
  }
})
