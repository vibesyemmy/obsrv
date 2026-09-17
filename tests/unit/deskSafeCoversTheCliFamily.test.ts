import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { minimatch } from 'minimatch'

/**
 * The desk-safe exclusion covers every spec that boots Electron through the
 * CLI — checked against the directory, not against itself.
 *
 * **The failure this exists for, measured.** The rule that the CLI specs run on
 * CI was enforced by everyone remembering it and writing their own pattern. On
 * 2026-09-17 a sweep used `/cli-/`, which is the pattern anyone would write,
 * and about fourteen `cli.spec.ts` tests ran on Opeyemi's desk: sixteen files
 * in that family are `cli-*` and **exactly one** is `cli.spec.ts`. A glob of
 * `cli*` is right and `cli-*` is wrong, and nothing in the repo said so.
 *
 * A test that only asserted "the glob matches the files the glob names" would
 * be circular and worthless. This one reads `tests/e2e/` and requires that
 * every spec whose name starts with `cli` is excluded — so adding
 * `cli-whatever.spec.ts` cannot quietly fall outside the rule, and renaming one
 * out of the family is a decision someone has to make here rather than an
 * accident.
 */

const ROOT = join(__dirname, '..', '..')
const E2E = join(ROOT, 'tests', 'e2e')

/** The patterns `playwright.config.ts` applies under `OBSRV_DESK_SAFE=1`. */
function deskSafeIgnores(): string[] {
  const config = readFileSync(join(ROOT, 'playwright.config.ts'), 'utf8')
  const line = /testIgnore:\s*\[([^\]]*)\]/.exec(config)
  expect(line, 'playwright.config.ts no longer declares a testIgnore for OBSRV_DESK_SAFE').not.toBeNull()
  return [...line![1]!.matchAll(/'([^']+)'/g)].map(m => m[1]!)
}

const excluded = (file: string, patterns: string[]): boolean => patterns.some(p => minimatch(`tests/e2e/${file}`, p))

describe('the desk-safe run', () => {
  it('leaves out every spec whose name starts with `cli`, not only the hyphenated ones', () => {
    const patterns = deskSafeIgnores()
    const specs = readdirSync(E2E).filter(f => f.endsWith('.spec.ts'))
    const cli = specs.filter(f => f.startsWith('cli'))
    // The family is real and this test is worth running.
    expect(cli.length, 'no cli specs found — has tests/e2e moved?').toBeGreaterThan(1)
    // And it contains the one that defeats `cli-*`, which is the whole point.
    expect(cli, 'cli.spec.ts is the file the obvious pattern misses').toContain('cli.spec.ts')
    const missed = cli.filter(f => !excluded(f, patterns))
    expect(missed, `not excluded from a desk-safe run: ${missed.join(', ')}`).toEqual([])
  })

  it('leaves the specs that are safe on a desk alone', () => {
    // The exclusion must not grow into "everything", which would make a local
    // run prove nothing and push people back to hand-written patterns.
    const patterns = deskSafeIgnores()
    const specs = readdirSync(E2E).filter(f => f.endsWith('.spec.ts'))
    const kept = specs.filter(f => !excluded(f, patterns))
    expect(kept.length, 'a desk-safe run would exclude nearly everything').toBeGreaterThan(specs.length / 2)
    expect(kept).toContain('live-capture-notes.spec.ts')
  })
})
