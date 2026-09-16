import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'

const ROOT = resolve(__dirname, '../..')
const SNAPSHOT = resolve(ROOT, 'docs/public-shape.json')
const { publicShape } = createRequire(__filename)('../../scripts/public-shape.js') as {
  publicShape: () => Promise<Record<string, string[] | null>>
}

/**
 * C2, `board/c2.md`: name breaking changes as such, by rule rather than by
 * habit. The rule is in `docs/compatibility.md` and the register is
 * `docs/breaking-changes.md`; this is the thing that fails when the register is
 * not kept.
 *
 * **On the MCP surface every shape change is breaking, in both directions.**
 * `docs/compatibility.md`: adding a field is breaking too, because every output
 * schema is `additionalProperties: false`, so a client holding the old schema
 * rejects a reply carrying a field it does not know. That is why this test does
 * not judge severity — it only notices that the published shape moved.
 *
 * **What a green here does NOT say.** It says the published MCP shape did not
 * move. It does not say nothing breaking happened. A field whose *meaning*
 * changes while its shape stays is invisible to this by construction — that is
 * `bug-orientation-name`, and it is the case C2 cares about most. The CLI's JSON
 * output is a second surface this does not cover either. Both are named in
 * `scripts/public-shape.js` so their absence is never read as coverage.
 */
describe('the published MCP shape', () => {
  it('has not moved without the change being named in the register', async () => {
    const recorded = JSON.parse(readFileSync(SNAPSHOT, 'utf8')) as Record<string, string[] | null>
    const current = await publicShape()

    // The instrument's own vacuity check. An empty or near-empty reading would
    // compare equal to an empty snapshot and report agreement while measuring
    // nothing — the failure this repo keeps finding, so it is refused here
    // rather than trusted.
    const paths = Object.values(current).reduce<number>((n, v) => n + (v?.length ?? 0), 0)
    expect(Object.keys(current).length, 'tools/list answered with no tools').toBeGreaterThan(0)
    expect(paths, 'the published schemas carry no key paths at all').toBeGreaterThan(50)

    const tools = [...new Set([...Object.keys(recorded), ...Object.keys(current)])].sort()
    const moved: string[] = []
    for (const tool of tools) {
      const before = recorded[tool]
      const after = current[tool]
      if (before === undefined) { moved.push(`  ${tool}: NEW TOOL`); continue }
      if (after === undefined) { moved.push(`  ${tool}: TOOL REMOVED`); continue }
      if (before === null || after === null) {
        if (before !== after) moved.push(`  ${tool}: output schema ${after === null ? 'REMOVED' : 'ADDED'}`)
        continue
      }
      const gone = before.filter(p => !after.includes(p))
      const added = after.filter(p => !before.includes(p))
      for (const p of gone) moved.push(`  ${tool}: VANISHED  ${p}`)
      for (const p of added) moved.push(`  ${tool}: APPEARED  ${p}`)
    }

    expect(
      moved,
      moved.length === 0
        ? ''
        : [
            '',
            'The published MCP output shape has moved:',
            ...moved,
            '',
            'On this surface that is a BREAKING change in either direction — the schemas are',
            'additionalProperties: false, so a client holding the old shape rejects a reply',
            'carrying a field it does not know (docs/compatibility.md).',
            '',
            'If the change is intended:',
            '  1. add an entry to docs/breaking-changes.md saying what moved and what a caller does,',
            '  2. refresh the snapshot:  node scripts/public-shape.js > docs/public-shape.json',
            '',
            'Both, in the same change. CI checks that the snapshot never moves without the register.',
            '',
          ].join('\n'),
    ).toEqual([])
  }, 60_000)
})
